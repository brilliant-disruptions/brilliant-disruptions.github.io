// quickbooks — QuickBooks Online adapter. The accounting truth behind FinOps:
// P&L, balance sheet, and A/R + A/P aging. Read-only; nothing is ever written
// back to QBO (§19).
//
// Three routes on one function, with different auth by design:
//   {action:"connect"}  MEMBER — returns the Intuit consent URL and issues a
//                             single-use `state` nonce. Gated on an active
//                             member's JWT: if it were open, a stranger could
//                             walk the whole flow with THEIR Intuit account and
//                             bind their books to this dashboard.
//   ?callback=true  PUBLIC  — Intuit redirects the browser here with ?code.
//                             Cannot require our own auth (Intuit won't send it),
//                             so it is gated on the `state` nonce connect issued.
//   ?sync=true      GATED   — X-Sync-Key (0023). Never publicly callable.
//
// Token lifecycle: the access token lives 1h, the refresh token 100 days — and
// Intuit issues a NEW refresh token on every refresh. Failing to persist it
// kills the connection, so each refresh writes it back through write_secret
// (0023), the service-role Vault write.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";
import { type Json, finishSync, requireSyncKey, snapshot } from "../_shared/finance.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "75";
const STATE_TTL_MS = 10 * 60_000;

// ── connections.config helpers (non-secret: realm id, env, oauth nonce) ──
async function readConfig(): Promise<Json> {
  const { data } = await supabase.from("connections").select("config").eq("provider", "quickbooks").maybeSingle();
  return ((data?.config as Json | null) ?? {}) as Json;
}

async function patchConfig(patch: Json): Promise<void> {
  const config = await readConfig();
  await supabase.from("connections").update({ config: { ...config, ...patch } }).eq("provider", "quickbooks");
}

async function apiBase(): Promise<string> {
  const env = ((await readConfig()).qb_env as string) ?? (await getSecret("QB_ENV")) ?? "production";
  return env === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

// ── OAuth ─────────────────────────────────────────────────────────
/** Built from SUPABASE_URL, not from req.url: the edge gateway may rewrite the
 *  inbound origin/path, and a redirect_uri that differs by one character between
 *  the authorize call and the token exchange fails the exchange. This form is
 *  identical in both, and is exactly what must be registered in the Intuit app. */
const REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/quickbooks?callback=true`;

/** Active-member check, same shape as github's repo picker: the JWT alone proves
 *  nothing (the anon key is a valid JWT and ships in the browser bundle). */
async function verifyMember(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return false;
  const { data } = await supabase.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return false;
  const { data: m } = await supabase.from("members").select("is_active").eq("id", uid).maybeSingle();
  return Boolean(m?.is_active);
}

async function exchangeToken(body: Record<string, string>): Promise<Json> {
  const id = await getSecret("QB_CLIENT_ID");
  const secret = await getSecret("QB_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as Json;
  if (!res.ok) throw new Error(`QBO token → ${res.status} ${json.error ?? ""} ${json.error_description ?? ""}`.trim());
  return json;
}

/** Persist the rotated refresh token. This is the single most failure-prone
 *  step in the whole integration: skip it once and the connection dies at the
 *  next refresh with a confusing invalid_grant. */
async function persistRefreshToken(token: string): Promise<void> {
  const { error } = await supabase.rpc("write_secret", {
    p_provider: "quickbooks",
    p_key_name: "QB_REFRESH_TOKEN",
    p_value: token,
  });
  if (error) throw new Error(`failed to persist rotated refresh token: ${error.message}`);
}

/** Trade the stored refresh token for an access token, persisting the new
 *  refresh token Intuit hands back. */
async function accessToken(): Promise<string> {
  const refresh = await getSecret("QB_REFRESH_TOKEN");
  if (!refresh) throw new Error("not connected — use Connect with Intuit in Connections");
  const tok = await exchangeToken({ grant_type: "refresh_token", refresh_token: refresh });
  const rotated = String(tok.refresh_token ?? "");
  if (rotated && rotated !== refresh) await persistRefreshToken(rotated);
  return String(tok.access_token);
}

// ── QBO report parsing ────────────────────────────────────────────
type ReportRow = {
  group?: string;
  type?: string;
  Summary?: { ColData?: { value?: string }[] };
  ColData?: { value?: string }[];
  Rows?: { Row?: ReportRow[] };
};

const toCents = (v: string | undefined): number => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** QBO reports nest arbitrarily deep, and the row that holds a total may be a
 *  Summary row or a plain data row. Flatten everything once, then look things up
 *  by group name or first-column label — far more robust than index-walking. */
function flattenRows(rows: ReportRow[] | undefined, out: ReportRow[] = []): ReportRow[] {
  for (const r of rows ?? []) {
    out.push(r);
    flattenRows(r.Rows?.Row, out);
  }
  return out;
}

/** Value of a row's LAST column (the total column in every report we read). */
function rowTotalCents(row: ReportRow | undefined): number {
  const cols = row?.Summary?.ColData ?? row?.ColData ?? [];
  return toCents(cols[cols.length - 1]?.value);
}

function findByGroup(rows: ReportRow[], group: string): ReportRow | undefined {
  return rows.find((r) => r.group === group);
}

function findByLabel(rows: ReportRow[], label: string): ReportRow | undefined {
  const want = label.toLowerCase();
  return rows.find((r) => {
    const first = (r.Summary?.ColData ?? r.ColData ?? [])[0]?.value ?? "";
    return first.toLowerCase() === want;
  });
}

async function report(token: string, name: string, params: Record<string, string>): Promise<Json> {
  const realm = ((await readConfig()).realm_id as string) ?? (await getSecret("QB_REALM_ID"));
  if (!realm) throw new Error("no QuickBooks realm id — reconnect from Connections");
  const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION }).toString();
  const res = await fetch(`${await apiBase()}/v3/company/${realm}/reports/${name}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = (await res.json()) as Json;
  if (!res.ok) throw new Error(`QBO ${name} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// ── Sync ──────────────────────────────────────────────────────────
async function runSync(): Promise<Json> {
  const clientId = await getSecret("QB_CLIENT_ID");
  if (!clientId || !(await getSecret("QB_REFRESH_TOKEN"))) {
    await finishSync(supabase, "quickbooks", false, { error: "not connected (bootstrapped)" });
    return { status: "skipped", reason: "QuickBooks not connected" };
  }

  try {
    const token = await accessToken();
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const written: Record<string, number> = {};

    // ── Profit & Loss, month to date ───────────────────────────
    const pl = await report(token, "ProfitAndLoss", { start_date: monthStart, end_date: today });
    const plRows = flattenRows(((pl.Rows as { Row?: ReportRow[] })?.Row) ?? []);
    const income = rowTotalCents(findByGroup(plRows, "Income") ?? findByLabel(plRows, "Total Income"));
    const expenses = rowTotalCents(findByGroup(plRows, "Expenses") ?? findByLabel(plRows, "Total Expenses"));
    const net = rowTotalCents(findByGroup(plRows, "NetIncome") ?? findByLabel(plRows, "Net Income"));
    const meta = { period_start: monthStart, period_end: today };
    await snapshot(supabase, "qb_revenue_mtd", income, meta);
    await snapshot(supabase, "qb_expenses_mtd", expenses, meta);
    // Net is read from QBO rather than income - expenses: QBO's own figure
    // accounts for cost of goods and other income the two totals don't cover.
    await snapshot(supabase, "qb_net_income_mtd", net, meta);
    Object.assign(written, { qb_revenue_mtd: income, qb_expenses_mtd: expenses, qb_net_income_mtd: net });

    // ── A/R aging ──────────────────────────────────────────────
    // Overdue = everything outside the "Current" bucket, i.e. total minus
    // current. That is the number that actually signals a collections problem.
    const ar = await report(token, "AgedReceivables", { report_date: today });
    const arRows = flattenRows(((ar.Rows as { Row?: ReportRow[] })?.Row) ?? []);
    const arTotalRow = arRows.find((r) => r.group === "GrandTotal") ?? findByLabel(arRows, "TOTAL") ?? findByLabel(arRows, "Total");
    const arTotal = rowTotalCents(arTotalRow);
    const arCols = arTotalRow?.Summary?.ColData ?? arTotalRow?.ColData ?? [];
    // Columns are [label, Current, 1-30, 31-60, 61-90, 91+, Total].
    const arCurrent = toCents(arCols[1]?.value);
    await snapshot(supabase, "qb_ar_total", arTotal, { report_date: today });
    await snapshot(supabase, "qb_ar_overdue", Math.max(0, arTotal - arCurrent), {
      report_date: today,
      current_cents: arCurrent,
      buckets: arCols.slice(1, -1).map((c) => toCents(c?.value)),
    });
    Object.assign(written, { qb_ar_total: arTotal, qb_ar_overdue: arTotal - arCurrent });

    // ── A/P aging ──────────────────────────────────────────────
    const ap = await report(token, "AgedPayables", { report_date: today });
    const apRows = flattenRows(((ap.Rows as { Row?: ReportRow[] })?.Row) ?? []);
    const apTotal = rowTotalCents(
      apRows.find((r) => r.group === "GrandTotal") ?? findByLabel(apRows, "TOTAL") ?? findByLabel(apRows, "Total"),
    );
    await snapshot(supabase, "qb_ap_total", apTotal, { report_date: today });
    written.qb_ap_total = apTotal;

    await finishSync(supabase, "quickbooks", true, { changes: Object.keys(written).length, metrics: written });
    return { status: "ok", metrics: written };
  } catch (err) {
    await finishSync(supabase, "quickbooks", false, { error: String(err) });
    return { status: "error", error: String(err) };
  }
}

// ── Routes ────────────────────────────────────────────────────────
// The connect route is called from the browser via functions.invoke, which sends
// authorization + content-type and therefore triggers a preflight. The edge
// runtime does not answer OPTIONS for us.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("sync") === "true") {
      const denied = await requireSyncKey(req, getSecret);
      if (denied) return denied;
      return Response.json(await runSync());
    }

    if (url.searchParams.get("callback") === "true") {
      const config = await readConfig();
      const expected = (config.qb_oauth_state as string) ?? "";
      const issuedAt = Date.parse((config.qb_oauth_state_at as string) ?? "");
      const given = url.searchParams.get("state") ?? "";
      const fresh = Number.isFinite(issuedAt) && Date.now() - issuedAt < STATE_TTL_MS;
      if (!expected || given !== expected || !fresh) {
        return Response.json({ error: "invalid or expired state — restart from ?connect=true" }, { status: 400 });
      }
      const code = url.searchParams.get("code");
      const realm = url.searchParams.get("realmId");
      if (!code || !realm) return Response.json({ error: "missing code/realmId" }, { status: 400 });

      const tok = await exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      });
      await persistRefreshToken(String(tok.refresh_token));
      // Burn the nonce so the same callback URL can't be replayed.
      await patchConfig({ realm_id: realm, qb_oauth_state: null, qb_oauth_state_at: null });
      await supabase
        .from("connections")
        .update({ status: "connected", updated_at: new Date().toISOString() })
        .eq("provider", "quickbooks");

      return new Response(
        "QuickBooks connected. You can close this tab — FinOps will fill in on the next sync.",
        { headers: { "Content-Type": "text/plain" } },
      );
    }

    // Everything else is body-driven, so it arrives with the caller's own JWT
    // via supabase.functions.invoke rather than as a browser navigation.
    const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Json) : {};

    if (body.action === "connect") {
      if (!(await verifyMember(req))) {
        return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
      }
      const clientId = await getSecret("QB_CLIENT_ID");
      if (!clientId) {
        return Response.json({ error: "set QB_CLIENT_ID and QB_CLIENT_SECRET in Connections first" }, { status: 400, headers: CORS });
      }
      // Single-use, time-boxed nonce — this is what makes the public callback
      // safe: an unsolicited ?code with no matching state is rejected.
      const state = crypto.randomUUID();
      await patchConfig({ qb_oauth_state: state, qb_oauth_state_at: new Date().toISOString() });
      const auth = new URL(AUTH_URL);
      auth.searchParams.set("client_id", clientId);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", SCOPE);
      auth.searchParams.set("redirect_uri", REDIRECT_URI);
      auth.searchParams.set("state", state);
      // Returned rather than redirected: the caller is a fetch, not a navigation.
      return Response.json({ url: auth.toString() }, { headers: CORS });
    }

    return Response.json({ error: 'POST {"action":"connect"}, or use ?callback=true / ?sync=true' }, { status: 400, headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
