// event-processor — the rules engine + action layer (spec §6.4, §7).
// Triggered by a Supabase Database Webhook on `events` INSERT (mechanism A),
// and by the pg_cron drain (`?drain=true`) as a resilience fallback (§6.3-B).
//
// Deno runtime. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the
// platform. The service role bypasses RLS — this is the only writer of
// events.processed, action_log, and approvals.

import { createClient } from "jsr:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Condition = { field: string; op: string; value: unknown };
type ActionSpec = { type: string; params?: Json };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── condition evaluation (§6.4) ───────────────────────────────────
function resolve(path: string, payload: Json): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Json)) {
      return (acc as Json)[key];
    }
    return undefined;
  }, payload);
}

function evalCondition(c: Condition, payload: Json): boolean {
  const actual = resolve(c.field, payload);
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "gt":
      return Number(actual) > Number(c.value);
    case "gte":
      return Number(actual) >= Number(c.value);
    case "lt":
      return Number(actual) < Number(c.value);
    case "lte":
      return Number(actual) <= Number(c.value);
    case "in":
      return Array.isArray(c.value) && (c.value as unknown[]).includes(actual);
    case "contains":
      return Array.isArray(actual) && actual.includes(c.value);
    case "exists":
      return actual !== undefined && actual !== null;
    case "changed_to":
      return resolve("to_stage", payload) === c.value ||
        resolve("to_status", payload) === c.value;
    case "changed_from":
      return resolve("from_stage", payload) === c.value ||
        resolve("from_status", payload) === c.value;
    default:
      return false;
  }
}

function ruleMatches(triggerEvent: string, eventType: string): boolean {
  if (triggerEvent.endsWith("*")) {
    return eventType.startsWith(triggerEvent.slice(0, -1));
  }
  return triggerEvent === eventType;
}

// ── action risk tiers (§7.3) ──────────────────────────────────────
const ACTION_RISK: Record<string, "low" | "medium" | "high"> = {
  "health.recompute": "low",
  "metric.snapshot": "low",
  "notify.push": "low",
  "notify.slack": "low",
  "prospect.set_next_action": "low",
  "reminder.create": "low",
  "milestone.check": "low",
  "ai.summarize": "low",
  "expense.recategorize": "low",
  "github.close_issue": "low",
  "github.comment": "low",
  "github.create_issue": "low",
  "gmail.draft": "medium",
  "deploy.trigger_staging": "medium",
  "agent.dispatch": "medium",
  "gmail.send": "high",
  "deploy.trigger_production": "high",
};

// ── low-risk action handlers (Phase 1) ────────────────────────────
// Returns a human-readable summary or throws on failure.
type Ctx = { event: Json; ruleId: string | null; params: Json };

async function recomputeHealth(buildId: string): Promise<string> {
  // Simplified deterministic health (§8.1) from current tickets + revenue.
  const { data: tickets } = await supabase
    .from("tickets")
    .select("stage, priority, type, closed_at, created_at, is_blocker")
    .eq("build_id", buildId);
  const { data: rev } = await supabase
    .from("revenue_entries")
    .select("mrr_cents")
    .eq("build_id", buildId);

  const t = tickets ?? [];
  const opened = t.length || 1;
  const done = t.filter((x) => x.stage === "done" || x.stage === "archived").length;
  const delivery = (done / opened) * 100;

  const openCritBugs = t.filter(
    (x) => x.priority === "critical" && x.stage !== "done" && x.stage !== "archived",
  ).length;
  const quality = Math.max(0, 100 - openCritBugs * 15);

  const inFlight = t.filter((x) => x.stage === "in_progress" || x.stage === "review").length;
  const momentum = Math.min(100, inFlight * 20);

  const openInfraSec = t.filter(
    (x) =>
      (x.type === "infra" || x.type === "security") &&
      x.priority === "high" &&
      x.stage !== "done",
  ).length;
  const techDebt = Math.max(0, 100 - openInfraSec * 20);

  const mrr = (rev ?? []).reduce((s, r) => s + (r.mrr_cents ?? 0), 0);
  const revenueSig = mrr > 0 ? 100 : 30;

  const health = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        0.3 * delivery +
          0.2 * quality +
          0.2 * momentum +
          0.15 * techDebt +
          0.15 * revenueSig,
      ),
    ),
  );

  await supabase.from("builds").update({ health_score: health }).eq("id", buildId);
  await supabase.from("metric_snapshots").upsert(
    {
      build_id: buildId,
      metric: "health",
      value_num: health,
      captured_on: new Date().toISOString().slice(0, 10),
      meta: { delivery, quality, momentum, techDebt, revenueSig },
    },
    { onConflict: "" }, // unique index handles dedupe per (build, metric, day)
  );
  return `Recomputed health for build → ${health}`;
}

async function snapshotMetric(buildId: string | null, metric: string, value: number): Promise<string> {
  await supabase.from("metric_snapshots").upsert({
    build_id: buildId,
    metric,
    value_num: value,
    captured_on: new Date().toISOString().slice(0, 10),
  });
  return `Snapshot ${metric} = ${value}`;
}

async function runAction(spec: ActionSpec, ctx: Ctx): Promise<{ status: string; summary: string }> {
  const buildId = (ctx.event.build_id as string) ?? null;
  switch (spec.type) {
    case "health.recompute": {
      if (!buildId) return { status: "skipped", summary: "health.recompute: no build" };
      return { status: "success", summary: await recomputeHealth(buildId) };
    }
    case "metric.snapshot": {
      const p = spec.params ?? {};
      return {
        status: "success",
        summary: await snapshotMetric(buildId, String(p.metric ?? "custom"), Number(p.value ?? 0)),
      };
    }
    case "notify.push": {
      const p = spec.params ?? {};
      // In-app notification surface for v1 = the action_log stream itself.
      return {
        status: "success",
        summary: `🔔 ${p.title ?? "Notification"}${p.severity ? ` (${p.severity})` : ""}`,
      };
    }
    default:
      // Phase 2+ actions (github.*, gmail.*, agent.dispatch, deploy.*, etc.)
      // are registered but not yet wired — log as skipped so the audit trail
      // is honest about what did/didn't run.
      return { status: "skipped", summary: `${spec.type}: proposed (Phase 2+)` };
  }
}

// ── process one event ─────────────────────────────────────────────
async function processEvent(eventId: string) {
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).single();
  if (!event || event.processed) return;

  const { data: build } = event.build_id
    ? await supabase.from("builds").select("slug").eq("id", event.build_id).maybeSingle()
    : { data: null };
  const buildSlug = build?.slug ?? null;

  const { data: rules } = await supabase
    .from("rules")
    .select("*")
    .eq("is_enabled", true)
    .order("priority", { ascending: true });

  const payload = (event.payload ?? {}) as Json;

  for (const rule of rules ?? []) {
    if (!ruleMatches(rule.trigger_event, event.type)) continue;
    if (rule.build_scope !== "all" && rule.build_scope !== buildSlug) continue;

    const conditions = (rule.conditions ?? []) as Condition[];
    if (!conditions.every((c) => evalCondition(c, payload))) continue;

    const actions = (rule.actions ?? []) as ActionSpec[];
    const gated =
      rule.requires_approval ||
      actions.some((a) => ACTION_RISK[a.type] === "high");

    if (gated) {
      // Create one approval for the whole rule; do not execute yet (§6.4).
      const { data: approval } = await supabase
        .from("approvals")
        .insert({
          event_id: event.id,
          rule_id: rule.id,
          action_spec: actions,
          title: rule.name,
          description: rule.description,
          risk: actions.some((a) => ACTION_RISK[a.type] === "high") ? "high" : "medium",
          build_id: event.build_id,
          expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        })
        .select()
        .single();
      await supabase.from("action_log").insert({
        event_id: event.id,
        rule_id: rule.id,
        action_type: "rule.gated",
        status: "awaiting_approval",
        actor: "system",
        build_id: event.build_id,
        summary: `Awaiting approval: ${rule.name}`,
        after_state: approval ?? null,
      });
      // Open a decision record for the premortem loop (§13.2).
      await supabase.from("events").insert({
        type: "decision.opened",
        build_id: event.build_id,
        actor: "system",
        entity_type: "approval",
        entity_id: approval?.id ?? null,
        payload: { ref_type: "approval", title: rule.name },
      });
      continue;
    }

    for (const spec of actions) {
      // Idempotency (§6.5): skip if an identical successful action exists.
      const { data: existing } = await supabase
        .from("action_log")
        .select("id")
        .eq("event_id", event.id)
        .eq("action_type", spec.type)
        .eq("status", "success")
        .maybeSingle();
      if (existing) {
        await supabase.from("action_log").insert({
          event_id: event.id,
          rule_id: rule.id,
          action_type: spec.type,
          status: "skipped",
          actor: "system",
          build_id: event.build_id,
          summary: `${spec.type}: already applied (idempotent)`,
        });
        continue;
      }

      try {
        const result = await runAction(spec, { event, ruleId: rule.id, params: spec.params ?? {} });
        await supabase.from("action_log").insert({
          event_id: event.id,
          rule_id: rule.id,
          action_type: spec.type,
          status: result.status,
          actor: "system",
          build_id: event.build_id,
          summary: result.summary,
        });
      } catch (err) {
        await supabase.from("action_log").insert({
          event_id: event.id,
          rule_id: rule.id,
          action_type: spec.type,
          status: "failed",
          actor: "system",
          build_id: event.build_id,
          summary: `${spec.type} failed`,
          error: String(err),
        });
      }
    }
  }

  await supabase
    .from("events")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("id", event.id);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("drain") === "true") {
      // Resilience drain: process unprocessed events older than 30s.
      const { data: stale } = await supabase
        .from("events")
        .select("id")
        .eq("processed", false)
        .lt("created_at", new Date(Date.now() - 30_000).toISOString())
        .order("created_at", { ascending: true })
        .limit(50);
      for (const e of stale ?? []) await processEvent(e.id);
      return Response.json({ drained: stale?.length ?? 0 });
    }

    // Database Webhook payload: { type, table, record, ... }
    const body = await req.json();
    const eventId = body?.record?.id ?? body?.id;
    if (!eventId) return Response.json({ error: "no event id" }, { status: 400 });
    await processEvent(eventId);
    return Response.json({ processed: eventId });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
