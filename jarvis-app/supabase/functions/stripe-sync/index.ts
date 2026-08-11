// stripe-sync — Stripe PULL adapter. The `stripe` function is a webhook: it only
// ever sees what happens after it was wired up, and it can't see the balance.
// This one asks Stripe directly, so FinOps shows real cash-in-Stripe, real MRR,
// and the history that predates the webhook.
//
// Deliberately a SEPARATE function from `stripe`: that one runs verify_jwt=false
// so it can verify Stripe's own signature, and hanging a ?sync=true branch off it
// would make sync callable by anyone. This one is gated on X-Sync-Key (0023).
//
// Read-only — no Stripe object is ever created or modified (§19). Degrades
// safely: with no STRIPE_SECRET_KEY it records sync.failed and returns.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import {
  type Json,
  emit as emitEvent,
  finishSync,
  recordRevenue,
  resolveBuild,
  requireSyncKey,
  snapshot,
} from "../_shared/finance.ts";
import { subscriptionsMrrCents, type StripeSubscription } from "../_shared/mrr.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const DAY_S = 86_400;

async function stripeGet(key: string, path: string, params: Record<string, string> = {}): Promise<Json> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const json = (await res.json()) as Json;
  if (!res.ok) throw new Error(`Stripe ${path} → ${res.status} ${((json.error as Json)?.message as string) ?? ""}`.trim());
  return json;
}

/** Walk a Stripe list endpoint to the end (or `maxPages`), following the
 *  starting_after cursor. Bounded so a decade of charges can't run the function
 *  past its timeout; the caller logs when the bound is hit. */
async function stripeList(
  key: string,
  path: string,
  params: Record<string, string>,
  maxPages = 20,
): Promise<{ items: Json[]; truncated: boolean }> {
  const items: Json[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await stripeGet(key, path, {
      limit: "100",
      ...params,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data = (res.data as Json[]) ?? [];
    items.push(...data);
    if (!res.has_more || data.length === 0) return { items, truncated: false };
    startingAfter = String(data[data.length - 1].id);
  }
  return { items, truncated: true };
}

const isoDay = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

async function runSync(): Promise<Json> {
  const key = await getSecret("STRIPE_SECRET_KEY");
  if (!key) {
    await finishSync(supabase, "stripe", false, { error: "no STRIPE_SECRET_KEY (bootstrapped)" });
    return { status: "skipped", reason: "STRIPE_SECRET_KEY unset" };
  }

  try {
    // ── Balance ──────────────────────────────────────────────────
    const balance = await stripeGet(key, "/balance");
    const sum = (rows: Json[] | undefined) =>
      (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const available = sum(balance.available as Json[]);
    const pending = sum(balance.pending as Json[]);
    await snapshot(supabase, "stripe_balance", available, { available_cents: available, pending_cents: pending });

    // ── Payouts landed in the last 30 days ───────────────────────
    const since = Math.floor(Date.now() / 1000) - 30 * DAY_S;
    const payouts = await stripeList(key, "/payouts", { "created[gte]": String(since) }, 5);
    const paidOut = payouts.items
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0);
    await snapshot(supabase, "stripe_payouts_30d", paidOut, { count: payouts.items.length });

    // ── Active subscriptions → normalized MRR ────────────────────
    // Snapshotted rather than written to revenue_entries: MRR is a standing
    // rate, not a payment. The payments themselves arrive below as charges.
    const subs = await stripeList(key, "/subscriptions", {
      status: "active",
      "expand[]": "data.items.data.price",
    }, 5);
    const mrr = subscriptionsMrrCents(subs.items as unknown as StripeSubscription[]);
    await snapshot(supabase, "stripe_mrr", mrr, { subscriptions: subs.items.length });

    // ── Backfill historical payments ─────────────────────────────
    // Two passes, split so nothing is counted twice:
    //   invoices — every subscription/invoiced payment, keyed on the INVOICE id.
    //              That is the exact external_id the webhook uses, so the
    //              idempotency guard makes this collision-safe by construction
    //              and it recovers all the history from before the webhook existed.
    //   charges  — only charges with NO invoice (true one-off payments). An
    //              invoiced charge would otherwise be recorded a second time
    //              under its own id, which the guard could not catch.
    let recorded = 0;
    let unattributed = 0;

    const invoices = await stripeList(key, "/invoices", { status: "paid" }, 20);
    for (const inv of invoices.items) {
      const amount = Number(inv.amount_paid ?? 0);
      if (amount <= 0) continue;
      const build = await resolveBuild(supabase, inv);
      if (!build) {
        unattributed++;
        continue;
      }
      const isSub = Boolean(inv.subscription);
      const result = await recordRevenue(supabase, build.id, {
        external_id: String(inv.id),
        kind: isSub ? "subscription" : "invoice",
        amount_cents: amount,
        // Matches the webhook's convention so a backfilled and a live-recorded
        // invoice contribute identically to MRR.
        mrr_cents: isSub ? amount : 0,
        customer_ref: (inv.customer as string) ?? null,
        occurred_on: isoDay(Number(inv.status_transitions
          ? ((inv.status_transitions as Json).paid_at ?? inv.created)
          : inv.created) ?? 0),
        actor: "sync:stripe",
      });
      if (result === "recorded") recorded++;
    }

    const charges = await stripeList(key, "/charges", {}, 20);
    for (const c of charges.items) {
      if (c.paid !== true || c.refunded === true) continue;
      if (c.invoice) continue;
      const build = await resolveBuild(supabase, c);
      if (!build) {
        unattributed++;
        continue;
      }
      const result = await recordRevenue(supabase, build.id, {
        external_id: String(c.id),
        kind: "one_time",
        amount_cents: Number(c.amount ?? 0),
        mrr_cents: 0,
        customer_ref: (c.customer as string) ?? null,
        occurred_on: isoDay(Number(c.created ?? 0)),
        actor: "sync:stripe",
      });
      if (result === "recorded") recorded++;
    }

    if (charges.truncated || invoices.truncated) {
      // Never let a bounded backfill read as "everything is here".
      await emitEvent(supabase, {
        type: "sync.partial",
        actor: "sync:stripe",
        payload: { provider: "stripe", reason: "charge backfill hit the page bound; older history not read" },
      });
    }

    await finishSync(supabase, "stripe", true, {
      changes: recorded,
      mrr_cents: mrr,
      balance_cents: available,
      unattributed,
      truncated: charges.truncated,
    });
    return { status: "ok", recorded, mrr_cents: mrr, balance_cents: available, unattributed, truncated: charges.truncated };
  } catch (err) {
    await finishSync(supabase, "stripe", false, { error: String(err) });
    return { status: "error", error: String(err) };
  }
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("sync") === "true") {
      const denied = await requireSyncKey(req, getSecret);
      if (denied) return denied;
      return Response.json(await runSync());
    }
    return Response.json({ error: "use ?sync=true" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
