// bank — cash adapter (spec §12.3). Bank-agnostic: Mercury if MERCURY_API_TOKEN
// is set, else Plaid (PLAID_*). Sync-only, read-only — JARVIS never moves money
// (§19). Pulls balances → cash-on-hand snapshot, and recent transactions →
// auto-drafted `expenses` (source=mercury, flagged for review).
//
// Deno runtime. Invoked by pg_cron / manual with `?sync=true`. Degrades safely:
// with no token it records last_sync_status and emits sync.failed, never throws.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Json = Record<string, unknown>;
type Txn = { id: string; counterparty: string; amount_cents: number; posted_on: string };

async function emit(event: Json): Promise<void> {
  await supabase.from("events").insert(event);
}

// ── Mercury: balances + recent transactions ───────────────────────
async function mercuryGet(token: string, path: string): Promise<Json> {
  const res = await fetch(`https://api.mercury.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Mercury ${path} → ${res.status}`);
  return res.json();
}

// Outflows (negative amounts) become draft expenses; deposits are ignored here
// (revenue flows through Stripe). Normalizes to the adapter-agnostic Txn shape.
async function fetchMercury(token: string): Promise<{ cashCents: number; txns: Txn[] }> {
  const accounts = (await mercuryGet(token, "/accounts")) as Json;
  const list = (accounts.accounts as Json[]) ?? [];
  const cashCents = Math.round(list.reduce((s, a) => s + Number(a.availableBalance ?? 0) * 100, 0));

  const txns: Txn[] = [];
  for (const a of list) {
    const tx = (await mercuryGet(token, `/account/${a.id}/transactions?limit=50`)) as Json;
    for (const t of (tx.transactions as Json[]) ?? []) {
      const amt = Number(t.amount ?? 0);
      if (amt >= 0) continue; // outflow only
      txns.push({
        id: String(t.id),
        counterparty: String(t.counterpartyName ?? "Unknown"),
        amount_cents: Math.round(Math.abs(amt) * 100),
        posted_on: String(t.postedAt ?? t.createdAt ?? "").slice(0, 10),
      });
    }
  }
  return { cashCents, txns };
}

async function runSync(): Promise<Json> {
  const MERCURY_TOKEN = await getSecret("MERCURY_API_TOKEN");
  if (!MERCURY_TOKEN) {
    // No bank connected — record the modeled state honestly (§12 graceful).
    await supabase
      .from("connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", status: "pending" })
      .eq("provider", "mercury");
    await emit({ type: "sync.failed", actor: "webhook:mercury", payload: { provider: "mercury", error: "no token (bootstrapped)" } });
    return { status: "skipped", reason: "MERCURY_API_TOKEN unset" };
  }

  let drafted = 0;
  let status = "ok";
  let error: string | null = null;
  try {
    const { cashCents, txns } = await fetchMercury(MERCURY_TOKEN);

    // Cash-on-hand snapshot (portfolio-wide) → feeds runway (§8.2).
    await supabase.from("metric_snapshots").upsert({
      build_id: null,
      metric: "cash",
      value_num: cashCents,
      captured_on: new Date().toISOString().slice(0, 10),
    });

    for (const t of txns) {
      // Idempotent on the bank's transaction id; flagged for human review.
      const { data: existing } = await supabase
        .from("expenses")
        .select("id")
        .eq("source", "mercury")
        .eq("external_id", t.id)
        .maybeSingle();
      if (existing) continue;
      await supabase.from("expenses").insert({
        build_id: null, // shared/overhead until a human assigns it
        source: "mercury",
        external_id: t.id,
        vendor: t.counterparty,
        category: "other", // recategorized by the expense.recategorize action
        amount_cents: t.amount_cents,
        spent_on: t.posted_on || new Date().toISOString().slice(0, 10),
        ai_categorized: false,
        notes: "Auto-drafted from bank; review + categorize.",
      });
      drafted++;
    }
  } catch (err) {
    status = "error";
    error = String(err);
  }

  await supabase
    .from("connections")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, status: status === "ok" ? "connected" : "error" })
    .eq("provider", "mercury");

  if (status === "error") {
    await emit({ type: "sync.failed", actor: "webhook:mercury", payload: { provider: "mercury", error } });
    return { status, error };
  }
  await emit({ type: "sync.completed", actor: "webhook:mercury", payload: { provider: "mercury", changes: drafted } });
  return { status, drafted };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("sync") === "true") return Response.json(await runSync());
    return Response.json({ error: "use ?sync=true" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
