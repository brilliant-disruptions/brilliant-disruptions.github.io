// Shared finance primitives for the money adapters (stripe webhook, stripe-sync,
// bank, quickbooks). Extracted so the webhook and the pull-sync agree on ONE
// definition of revenue idempotency — they both write revenue_entries and would
// otherwise be able to double-count the same dollar.
//
// Deno runtime. Every helper takes the caller's service-role client rather than
// building its own, so a function keeps a single connection.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type Json = Record<string, unknown>;

export async function emit(supabase: SupabaseClient, event: Json): Promise<void> {
  await supabase.from("events").insert(event);
}

/** Resolve the build for a provider object. Preference: object.metadata.build_slug;
 *  fallback: the only active build (single-build studio). Null → can't attribute. */
export async function resolveBuild(supabase: SupabaseClient, obj: Json): Promise<{ id: string } | null> {
  const slug = ((obj.metadata as Json)?.build_slug as string) ?? null;
  if (slug) {
    const { data } = await supabase.from("builds").select("id").eq("slug", slug).maybeSingle();
    if (data) return data as { id: string };
  }
  const { data: actives } = await supabase.from("builds").select("id").eq("is_active", true).limit(2);
  if (actives && actives.length === 1) return actives[0] as { id: string };
  return null;
}

/** Record a paid revenue entry + emit revenue.recorded / mrr.changed, and
 *  revenue.first_dollar the first time a build is ever paid (§8.3).
 *
 *  Idempotent on (build_id, external_id) — the ONLY guard against the webhook
 *  and the backfill recording the same payment twice. Callers must therefore use
 *  a stable, provider-unique external_id (a Stripe invoice id, a charge id) and
 *  must not record both a charge and the invoice that produced it. */
export async function recordRevenue(
  supabase: SupabaseClient,
  buildId: string,
  args: {
    external_id: string;
    kind: string;
    amount_cents: number;
    mrr_cents: number;
    customer_ref?: string | null;
    occurred_on?: string | null;
    actor?: string;
  },
): Promise<string> {
  const actor = args.actor ?? "webhook:stripe";
  const { data: existing } = await supabase
    .from("revenue_entries")
    .select("id")
    .eq("build_id", buildId)
    .eq("external_id", args.external_id)
    .maybeSingle();
  if (existing) return "duplicate (skipped)";

  const { count: priorCount } = await supabase
    .from("revenue_entries")
    .select("id", { count: "exact", head: true })
    .eq("build_id", buildId)
    .eq("status", "paid");

  const { data: inserted } = await supabase
    .from("revenue_entries")
    .insert({
      build_id: buildId,
      source: "stripe",
      external_id: args.external_id,
      kind: args.kind,
      customer_ref: args.customer_ref ?? null,
      amount_cents: args.amount_cents,
      mrr_cents: args.mrr_cents,
      status: "paid",
      // Backfilled rows must land on the date they actually happened, or a
      // year of history would stack onto today and distort every trend.
      ...(args.occurred_on ? { occurred_on: args.occurred_on } : {}),
    })
    .select()
    .single();

  await emit(supabase, {
    type: "revenue.recorded",
    build_id: buildId,
    actor,
    entity_type: "revenue_entry",
    entity_id: inserted?.id ?? null,
    payload: { amount_cents: args.amount_cents, mrr_cents: args.mrr_cents, kind: args.kind },
  });
  if (args.mrr_cents) {
    await emit(supabase, { type: "mrr.changed", build_id: buildId, actor, payload: { delta_cents: args.mrr_cents } });
  }
  if ((priorCount ?? 0) === 0) {
    await emit(supabase, {
      type: "revenue.first_dollar",
      build_id: buildId,
      actor,
      entity_type: "revenue_entry",
      entity_id: inserted?.id ?? null,
      payload: { amount_cents: args.amount_cents },
    });
  }
  return "recorded";
}

/** Upsert a portfolio-level daily metric. metric_snapshots' unique index on
 *  (build_id, metric, captured_on) makes re-running a sync the same day a
 *  no-op-with-fresh-values rather than a duplicate row. */
export async function snapshot(
  supabase: SupabaseClient,
  metric: string,
  valueNum: number,
  meta: Json = {},
): Promise<void> {
  await supabase.from("metric_snapshots").upsert(
    {
      build_id: null,
      metric,
      value_num: valueNum,
      captured_on: new Date().toISOString().slice(0, 10),
      meta,
    },
    { onConflict: "build_id,metric,captured_on" },
  );
}

/** Close out a sync run: stamp the connection row and emit the matching event.
 *  Every adapter reports the same way so the FinOps sync strip can render a
 *  stale number as visibly stale instead of silently wrong. */
export async function finishSync(
  supabase: SupabaseClient,
  provider: string,
  ok: boolean,
  detail: Json = {},
): Promise<void> {
  await supabase
    .from("connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: ok ? "ok" : "error",
      status: ok ? "connected" : "error",
    })
    .eq("provider", provider);
  await emit(supabase, {
    type: ok ? "sync.completed" : "sync.failed",
    actor: `webhook:${provider}`,
    payload: { provider, ...detail },
  });
}

/** Guard the sync route of a function that must NOT be publicly callable.
 *
 *  Supabase's verify_jwt only proves *a* valid project JWT, and the bearer the
 *  DB uses (`functions_bearer`, see 0008) is the ANON key — which ships in the
 *  browser bundle. So JWT verification alone would leave `?sync=true` open to
 *  anyone who reads the page source. pg_cron sends an additional X-Sync-Key
 *  header (0023) holding a random secret that never leaves the server.
 *
 *  Fail-closed: an unset JARVIS_SYNC_KEY denies rather than allows.
 *  Returns null when authorized, or the response to return when not. */
export async function requireSyncKey(req: Request, getSecret: (n: string) => Promise<string>): Promise<Response | null> {
  const expected = await getSecret("JARVIS_SYNC_KEY");
  const given = req.headers.get("x-sync-key") ?? "";
  if (!expected || given.length !== expected.length) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Constant-time compare — this key gates every financial sync.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? null : Response.json({ error: "unauthorized" }, { status: 401 });
}
