// bank — cash adapter (spec §12.3). Bank-agnostic: Plaid if PLAID_ACCESS_TOKEN
// is set (this is how Relay is reached — Relay has no public REST API), else
// Mercury if MERCURY_API_TOKEN is set. Sync-only, read-only — JARVIS never moves
// money (§19). Pulls balances → cash-on-hand snapshot, and recent transactions →
// auto-drafted `expenses` (source=plaid|mercury, flagged for review).
//
// Deno runtime. Invoked by pg_cron / manual with `?sync=true`. Degrades safely:
// with no token it records last_sync_status and emits sync.failed, never throws.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { type Json, emit as emitEvent, snapshot, requireSyncKey } from "../_shared/finance.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Txn = { id: string; counterparty: string; amount_cents: number; posted_on: string };

const emit = (event: Json) => emitEvent(supabase, event);

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

// ── Plaid: balances + incremental transactions (this is the Relay path) ──
// Relay publishes no general REST API, so Relay is reached the way every other
// tool reaches it: a Plaid Item. The access token is long-lived and obtained
// once via Plaid Link (out of band for now) and pasted into the Connections UI.
async function plaidPost(path: string, body: Json): Promise<Json> {
  const env = (await getSecret("PLAID_ENV")) || "production";
  const res = await fetch(`https://${env}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Json;
  // Plaid returns a 400 with error_code for expired/revoked items — surface the
  // code, not just the status, so a re-consent need is obvious in the event log.
  if (!res.ok) throw new Error(`Plaid ${path} → ${res.status} ${json.error_code ?? ""} ${json.error_message ?? ""}`.trim());
  return json;
}

/** Cursor for /transactions/sync. Non-secret, so it lives in connections.config
 *  rather than the Vault. Without it every sync would re-walk all history. */
async function readCursor(): Promise<string | null> {
  const { data } = await supabase.from("connections").select("config").eq("provider", "plaid").maybeSingle();
  return ((data?.config as Json | null)?.plaid_cursor as string) ?? null;
}

async function writeCursor(cursor: string): Promise<void> {
  const { data } = await supabase.from("connections").select("config").eq("provider", "plaid").maybeSingle();
  const config = ((data?.config as Json | null) ?? {}) as Json;
  await supabase
    .from("connections")
    .update({ config: { ...config, plaid_cursor: cursor } })
    .eq("provider", "plaid");
}

async function fetchPlaid(
  clientId: string,
  secret: string,
  accessToken: string,
): Promise<{ cashCents: number; txns: Txn[]; accounts: Json[]; cursor: string | null }> {
  const auth = { client_id: clientId, secret, access_token: accessToken };

  const balances = await plaidPost("/accounts/balance/get", auth);
  const accounts = ((balances.accounts as Json[]) ?? []).filter(
    (a) => a.type === "depository", // cash on hand only — not credit lines
  );
  const cashCents = Math.round(
    accounts.reduce((s, a) => {
      const b = (a.balances as Json) ?? {};
      // `available` excludes pending holds; fall back to `current` when Plaid
      // doesn't supply it (some institutions omit it entirely).
      return s + Number(b.available ?? b.current ?? 0) * 100;
    }, 0),
  );

  // Incremental: /transactions/sync only returns what changed since the cursor.
  const txns: Txn[] = [];
  let cursor = await readCursor();
  let hasMore = true;
  let pages = 0;
  while (hasMore && pages < 20) {
    const page = await plaidPost("/transactions/sync", { ...auth, ...(cursor ? { cursor } : {}), count: 500 });
    for (const t of (page.added as Json[]) ?? []) {
      // Plaid sign convention is the inverse of a bank statement: POSITIVE means
      // money left the account. Deposits (negative) are skipped — revenue comes
      // through Stripe/QuickBooks, and counting it here would double-count it.
      const amt = Number(t.amount ?? 0);
      if (amt <= 0) continue;
      txns.push({
        id: String(t.transaction_id),
        counterparty: String(t.merchant_name ?? t.name ?? "Unknown"),
        amount_cents: Math.round(amt * 100),
        posted_on: String(t.authorized_date ?? t.date ?? "").slice(0, 10),
      });
    }
    cursor = (page.next_cursor as string) ?? cursor;
    hasMore = Boolean(page.has_more);
    pages++;
  }

  return { cashCents, txns, accounts, cursor };
}

async function runSync(): Promise<Json> {
  const PLAID_ACCESS_TOKEN = await getSecret("PLAID_ACCESS_TOKEN");
  const PLAID_CLIENT_ID = await getSecret("PLAID_CLIENT_ID");
  const PLAID_SECRET = await getSecret("PLAID_SECRET");
  const MERCURY_TOKEN = await getSecret("MERCURY_API_TOKEN");

  // Plaid wins when fully configured (it is the Relay path); Mercury is the
  // legacy fallback. `provider` is also the connections row we report against.
  const usePlaid = Boolean(PLAID_ACCESS_TOKEN && PLAID_CLIENT_ID && PLAID_SECRET);
  const provider = usePlaid ? "plaid" : "mercury";

  if (!usePlaid && !MERCURY_TOKEN) {
    // No bank connected — record the modeled state honestly (§12 graceful).
    // Reported against plaid (the intended path) so the FinOps sync strip
    // points at the connection the user actually needs to finish.
    await supabase
      .from("connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", status: "pending" })
      .eq("provider", "plaid");
    await emit({ type: "sync.failed", actor: "webhook:plaid", payload: { provider: "plaid", error: "no token (bootstrapped)" } });
    return { status: "skipped", reason: "PLAID_ACCESS_TOKEN / MERCURY_API_TOKEN unset" };
  }

  let drafted = 0;
  let status = "ok";
  let error: string | null = null;
  let nextCursor: string | null = null;
  try {
    const result = usePlaid
      ? await fetchPlaid(PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ACCESS_TOKEN)
      : { ...(await fetchMercury(MERCURY_TOKEN)), accounts: [] as Json[], cursor: null };
    const { cashCents, txns } = result;

    // Cash-on-hand snapshot (portfolio-wide) → feeds runway (§8.2).
    await snapshot(supabase, "cash", cashCents, {
      provider,
      accounts: (result.accounts ?? []).map((a) => ({
        name: a.name ?? a.official_name ?? null,
        mask: a.mask ?? null,
        available_cents: Math.round(Number(((a.balances as Json) ?? {}).available ?? ((a.balances as Json) ?? {}).current ?? 0) * 100),
      })),
    });

    for (const t of txns) {
      // Idempotent on the bank's transaction id; flagged for human review.
      const { data: existing } = await supabase
        .from("expenses")
        .select("id")
        .eq("source", provider)
        .eq("external_id", t.id)
        .maybeSingle();
      if (existing) continue;
      await supabase.from("expenses").insert({
        build_id: null, // shared/overhead until a human assigns it
        source: provider,
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
    nextCursor = result.cursor;
  } catch (err) {
    status = "error";
    error = String(err);
  }

  // Only advance the cursor after the drafts committed — a mid-sync failure
  // must re-deliver those transactions, not silently skip them.
  if (status === "ok" && usePlaid && nextCursor) await writeCursor(nextCursor);

  await supabase
    .from("connections")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, status: status === "ok" ? "connected" : "error" })
    .eq("provider", provider);

  if (status === "error") {
    await emit({ type: "sync.failed", actor: `webhook:${provider}`, payload: { provider, error } });
    return { status, error };
  }
  await emit({ type: "sync.completed", actor: `webhook:${provider}`, payload: { provider, changes: drafted } });
  return { status, provider, drafted };
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
