// stripe — revenue adapter (spec §12.2). Read-only: maps Stripe billing onto
// the JARVIS event bus (revenue.recorded, mrr.changed, revenue.first_dollar).
//
// Deno runtime, verify_jwt=false: Stripe sends a Stripe-Signature header, not a
// Supabase JWT — this function verifies the signing secret itself.
//
// Degrades safely: with no STRIPE_WEBHOOK_SECRET it rejects (fail-closed); with
// an unmappable customer it returns 200 ignored (no revenue_entries row, which
// requires a build). Nothing here moves money or creates Stripe objects (§19).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSecret } from "../_shared/secrets.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Json = Record<string, unknown>;

// ── Stripe signature: header "t=<ts>,v1=<hmac>"; HMAC-SHA256(`${t}.${raw}`) ──
async function verifyStripe(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!secret) return false; // fail-closed: no signing secret configured
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(v1);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function emit(event: Json): Promise<void> {
  await supabase.from("events").insert(event);
}

// Resolve the build for a Stripe object. Preference: object.metadata.build_slug;
// fallback: the only active build (single-build studio). Null → can't attribute.
async function resolveBuild(obj: Json): Promise<{ id: string } | null> {
  const slug = ((obj.metadata as Json)?.build_slug as string) ?? null;
  if (slug) {
    const { data } = await supabase.from("builds").select("id").eq("slug", slug).maybeSingle();
    if (data) return data;
  }
  const { data: actives } = await supabase.from("builds").select("id").eq("is_active", true).limit(2);
  if (actives && actives.length === 1) return actives[0];
  return null;
}

// Record a paid revenue entry + emit revenue.recorded / mrr.changed, and
// revenue.first_dollar the first time a build is ever paid (§8.3).
async function recordRevenue(
  buildId: string,
  args: { external_id: string; kind: string; amount_cents: number; mrr_cents: number; customer_ref?: string | null },
): Promise<string> {
  // Idempotency: skip if this Stripe object already produced an entry.
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
    })
    .select()
    .single();

  await emit({
    type: "revenue.recorded",
    build_id: buildId,
    actor: "webhook:stripe",
    entity_type: "revenue_entry",
    entity_id: inserted?.id ?? null,
    payload: { amount_cents: args.amount_cents, mrr_cents: args.mrr_cents, kind: args.kind },
  });
  if (args.mrr_cents) {
    await emit({ type: "mrr.changed", build_id: buildId, actor: "webhook:stripe", payload: { delta_cents: args.mrr_cents } });
  }
  if ((priorCount ?? 0) === 0) {
    await emit({
      type: "revenue.first_dollar",
      build_id: buildId,
      actor: "webhook:stripe",
      entity_type: "revenue_entry",
      entity_id: inserted?.id ?? null,
      payload: { amount_cents: args.amount_cents },
    });
  }
  return "recorded";
}

async function handleEvent(evt: Json): Promise<Json> {
  const type = evt.type as string;
  const obj = ((evt.data as Json)?.object as Json) ?? {};
  const build = await resolveBuild(obj);
  if (!build && type !== "charge.refunded") return { ignored: `unmappable ${type}` };

  switch (type) {
    case "invoice.paid": {
      const amount = Number(obj.amount_paid ?? 0);
      const isSub = Boolean(obj.subscription);
      const result = await recordRevenue(build!.id, {
        external_id: String(obj.id),
        kind: isSub ? "subscription" : "invoice",
        amount_cents: amount,
        mrr_cents: isSub ? amount : 0,
        customer_ref: (obj.customer as string) ?? null,
      });
      return { result };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const items = ((obj.items as Json)?.data as Json[]) ?? [];
      const mrr = items.reduce((s, it) => s + Number((it.price as Json)?.unit_amount ?? 0) * Number(it.quantity ?? 1), 0);
      await emit({ type: "mrr.changed", build_id: build!.id, actor: "webhook:stripe", payload: { mrr_cents: mrr, subscription: obj.id } });
      return { result: "mrr.changed emitted" };
    }
    case "customer.subscription.deleted": {
      // Churn: the subscription's MRR drops to zero (§8.3 MRR must decrease).
      const items = ((obj.items as Json)?.data as Json[]) ?? [];
      const lost = items.reduce((s, it) => s + Number((it.price as Json)?.unit_amount ?? 0) * Number(it.quantity ?? 1), 0);
      await emit({ type: "mrr.changed", build_id: build!.id, actor: "webhook:stripe", payload: { delta_cents: -lost, churned: true, subscription: obj.id } });
      return { result: "churn mrr.changed emitted" };
    }
    case "charge.refunded": {
      if (!build) return { ignored: "refund: unmappable" };
      const refunded = Number(obj.amount_refunded ?? 0);
      await emit({ type: "revenue.recorded", build_id: build.id, actor: "webhook:stripe", payload: { refunded: true, amount_cents: -refunded } });
      // A refunded subscription invoice also drops recurring revenue.
      if (obj.invoice) {
        await emit({ type: "mrr.changed", build_id: build.id, actor: "webhook:stripe", payload: { delta_cents: -refunded, refund: true } });
      }
      return { result: "refund recorded" };
    }
    default:
      return { ignored: type };
  }
}

Deno.serve(async (req) => {
  try {
    const raw = await req.text();
    const secret = await getSecret("STRIPE_WEBHOOK_SECRET");
    const ok = await verifyStripe(raw, req.headers.get("stripe-signature"), secret);
    if (!ok) return Response.json({ error: "invalid signature" }, { status: 401 });
    const evt = raw ? (JSON.parse(raw) as Json) : {};
    return Response.json(await handleEvent(evt));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
