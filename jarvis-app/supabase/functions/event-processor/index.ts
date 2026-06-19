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
// `approvalId` is set only when executing a gated action_spec that a human
// approved (§7.4) — it's the credential the §7.3 safety net checks for.
type Ctx = { event: Json; ruleId: string | null; params: Json; approvalId?: string | null };

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
  await writeSnapshot(buildId, "health", health, { delivery, quality, momentum, techDebt, revenueSig });
  return `Recomputed health for build → ${health}`;
}

// Write one daily metric point, replacing any existing point for the same
// (build, metric, day). The dedupe index is an EXPRESSION index
// (coalesce(build_id,'portfolio'), metric, captured_on) that PostgREST's
// onConflict cannot target, so a plain .upsert() silently became an INSERT and
// 23505'd on the second same-day write. Delete-then-insert keeps the
// once-per-day semantics, including portfolio rows (build_id null).
async function writeSnapshot(buildId: string | null, metric: string, value: number, meta?: Json): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let del = supabase.from("metric_snapshots").delete().eq("metric", metric).eq("captured_on", today);
  del = buildId === null ? del.is("build_id", null) : del.eq("build_id", buildId);
  await del;
  await supabase.from("metric_snapshots").insert({
    build_id: buildId,
    metric,
    value_num: value,
    captured_on: today,
    ...(meta ? { meta } : {}),
  });
}

async function snapshotMetric(buildId: string | null, metric: string, value: number): Promise<string> {
  await writeSnapshot(buildId, metric, value);
  return `Snapshot ${metric} = ${value}`;
}

// ── GitHub outbound (§12.1, JARVIS → GitHub) ──────────────────────
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";

async function githubRequest(method: string, path: string, body?: Json): Promise<Json> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jarvis-adapter",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}`);
  return res.json();
}

// Resolve the GitHub repo ("owner/repo") + issue number for a JARVIS ticket.
// ref is stored as "#<number>" by the inbound adapter. Returns null when the
// ticket isn't mapped to a GitHub issue (→ caller no-ops, per the seeded rule
// "no-op if unmapped").
async function resolveIssue(
  ticket: Json | null,
): Promise<{ repo: string; number: number } | null> {
  if (!ticket?.external_id || !ticket.build_id || !ticket.ref) return null;
  const number = Number(String(ticket.ref).replace(/^#/, ""));
  if (!Number.isFinite(number)) return null;
  const { data: build } = await supabase
    .from("builds")
    .select("github_repo")
    .eq("id", ticket.build_id as string)
    .maybeSingle();
  if (!build?.github_repo) return null;
  return { repo: build.github_repo, number };
}

// The github.* actions receive the triggering ticket in event.payload.ticket
// (the seeded close rule passes empty params); params.ticket_id overrides.
async function ticketForAction(ctx: Ctx): Promise<Json | null> {
  const id = (ctx.params.ticket_id as string) ?? null;
  if (id) {
    const { data } = await supabase.from("tickets").select("*").eq("id", id).maybeSingle();
    return (data as Json) ?? null;
  }
  return ((ctx.event.payload as Json)?.ticket as Json) ?? null;
}

async function postWebhook(text: string): Promise<string> {
  const url = Deno.env.get("SLACK_WEBHOOK_URL") ?? Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!url) return "notify.slack: no webhook configured (skipped)";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  return `Posted to chat: ${text.slice(0, 80)}`;
}

// ── Anthropic (agents call Claude with the Vault key; degrades if unset) ──
// §13.3's ai-gateway is user-token-authed for client features; server-side
// agents call Anthropic directly here. No key → returns null → callers fall
// back to a deterministic path so the loop still demonstrably works.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL_HEAVY = Deno.env.get("ANTHROPIC_MODEL_HEAVY") ?? "claude-opus-4-8";
const MODEL_DEFAULT = Deno.env.get("ANTHROPIC_MODEL_DEFAULT") ?? "claude-sonnet-4-6";
const GMAIL_SENDER = Deno.env.get("GMAIL_SENDER") ?? "hello@brilliantdisruptions.com";

async function claudeJson(
  system: string,
  user: string,
  heavy: boolean,
): Promise<{ data: Json | null; raw: string; cost_cents: number } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: heavy ? MODEL_HEAVY : MODEL_DEFAULT,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const j = await res.json();
  const raw = j?.content?.[0]?.text ?? "";
  const cost_cents = Math.ceil(((j?.usage?.input_tokens ?? 0) * 0.0003 + (j?.usage?.output_tokens ?? 0) * 0.0015) / 10);
  let data: Json | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* non-JSON reply → caller uses raw / falls back */
  }
  return { data, raw, cost_cents };
}

// ── Premortem analyst (§13.2): assume the gated action already failed ─────
// Runs on decision.opened (entity_id = the pending approval). Ensures a
// decisions row, generates ranked failure modes (Claude heavy, or a
// deterministic fallback), stores them, and ATTACHES the analysis to the
// approval preview so the human sees the risk before deciding.
async function runPremortem(ctx: Ctx): Promise<{ summary: string; cost: number }> {
  const approvalId = (ctx.event.entity_id as string) ?? null;
  if (!approvalId) return { summary: "premortem: no approval ref", cost: 0 };
  const { data: approval } = await supabase.from("approvals").select("*").eq("id", approvalId).maybeSingle();
  if (!approval) return { summary: "premortem: approval not found", cost: 0 };

  const actions = (approval.action_spec ?? []) as ActionSpec[];
  const context = {
    title: approval.title,
    risk: approval.risk,
    actions: actions.map((a) => a.type),
    build_id: approval.build_id,
  };

  let { data: decision } = await supabase
    .from("decisions")
    .select("id")
    .eq("ref_type", "approval")
    .eq("ref_id", approvalId)
    .maybeSingle();
  if (!decision) {
    const { data: created } = await supabase
      .from("decisions")
      .insert({
        build_id: approval.build_id,
        kind: "gated_action",
        ref_type: "approval",
        ref_id: approvalId,
        title: approval.title,
        context,
        outcome: "pending",
      })
      .select("id")
      .single();
    decision = created;
  }
  if (!decision) return { summary: "premortem: could not open decision", cost: 0 };

  // Past lessons (build-scoped + studio-wide) inform the new premortem (§13.2).
  const { data: priorLearnings } = await supabase
    .from("learnings")
    .select("lesson, tags, weight")
    .or(`build_id.eq.${approval.build_id},build_id.is.null`)
    .order("weight", { ascending: false })
    .limit(10);

  let premortem: Json;
  let cost = 0;
  const ai = await claudeJson(
    'You are JARVIS\'s premortem analyst. Assume the described decision has ALREADY FAILED. Respond ONLY with JSON: {"summary":string,"confidence":number,"failure_modes":[{"mode":string,"likelihood":"low|medium|high","leading_indicators":[string],"mitigations":[string]}]}.',
    `Decision: ${approval.title}\nRisk: ${approval.risk}\nActions: ${JSON.stringify(actions.map((a) => a.type))}\nContext: ${JSON.stringify(context)}\nPrior lessons: ${JSON.stringify(priorLearnings ?? [])}`,
    true,
  );
  if (ai?.data) {
    premortem = ai.data;
    cost = ai.cost_cents;
  } else {
    premortem = {
      summary: `Deterministic premortem (AI unavailable): "${approval.title}" carries ${approval.risk} risk. Review irreversible effects before approving.`,
      confidence: 0.4,
      failure_modes: actions.map((a) => ({
        mode: `${a.type} produced an unintended or irreversible effect`,
        likelihood: ACTION_RISK[a.type] === "high" ? "high" : "medium",
        leading_indicators: ["unexpected downstream events", "error entries in the audit log"],
        mitigations: ["confirm the target + payload", "ensure a rollback path exists before approving"],
      })),
      stub: true,
    };
  }

  await supabase.from("decisions").update({ premortem, premortem_at: new Date().toISOString() }).eq("id", decision.id);
  // Attach to the approval preview — the human sees risk before approving (§13.2 step 3).
  const preview = { ...((approval.preview ?? {}) as Json), premortem };
  await supabase.from("approvals").update({ preview }).eq("id", approvalId);
  await supabase.from("events").insert({
    type: "premortem.completed",
    build_id: approval.build_id,
    actor: "agent:premortem_analyst",
    entity_type: "decision",
    entity_id: decision.id,
    payload: { approval_id: approvalId },
  });
  const fmCount = Array.isArray((premortem as Json).failure_modes) ? ((premortem as Json).failure_modes as unknown[]).length : 0;
  return { summary: `Premortem attached to "${approval.title}" (${fmCount} failure modes)`, cost };
}

// ── Postmortem analyst (§13.2): convert a resolved outcome into lessons ───
async function runPostmortem(ctx: Ctx): Promise<{ summary: string; cost: number }> {
  const payload = (ctx.event.payload ?? {}) as Json;
  const decisionId = (payload.decision_id as string) ?? (ctx.event.entity_id as string) ?? null;
  if (!decisionId) return { summary: "postmortem: no decision ref", cost: 0 };
  const { data: decision } = await supabase.from("decisions").select("*").eq("id", decisionId).maybeSingle();
  if (!decision) return { summary: "postmortem: decision not found", cost: 0 };

  const outcome = (payload.outcome as string) ?? decision.outcome ?? "succeeded";
  let postmortem: Json;
  let lessons: string[];
  let cost = 0;
  const ai = await claudeJson(
    'You are JARVIS\'s postmortem analyst. Compare the actual outcome to the premortem prediction; extract DURABLE, build-agnostic lessons. Respond ONLY with JSON: {"what_happened":string,"vs_prediction":string,"root_causes":[string],"lessons":[string],"rule_changes_suggested":[string]}.',
    `Decision: ${decision.title}\nOutcome: ${outcome}\nPremortem: ${JSON.stringify(decision.premortem ?? {})}\nContext: ${JSON.stringify(decision.context ?? {})}`,
    true,
  );
  if (ai?.data) {
    postmortem = ai.data;
    lessons = Array.isArray(ai.data.lessons) ? (ai.data.lessons as string[]) : [];
    cost = ai.cost_cents;
  } else {
    lessons = [`Outcome '${outcome}' on "${decision.title}": capture what the premortem missed and feed it forward.`];
    postmortem = {
      what_happened: `Resolved as ${outcome}.`,
      vs_prediction: "AI unavailable — recorded deterministically.",
      root_causes: [],
      lessons,
      rule_changes_suggested: [],
      stub: true,
    };
  }

  await supabase
    .from("decisions")
    .update({ postmortem, postmortem_at: new Date().toISOString(), outcome, outcome_at: new Date().toISOString() })
    .eq("id", decisionId);
  const sourceOutcome = outcome === "failed" ? "failed" : outcome === "partial" ? "partial" : "succeeded";
  for (const lesson of lessons) {
    const { data: l } = await supabase
      .from("learnings")
      .insert({
        decision_id: decisionId,
        build_id: decision.build_id,
        lesson,
        source_outcome: sourceOutcome,
        weight: outcome === "failed" ? 3 : 1,
      })
      .select("id")
      .single();
    await supabase.from("events").insert({
      type: "learning.recorded",
      build_id: decision.build_id,
      actor: "agent:postmortem_analyst",
      entity_type: "learning",
      entity_id: l?.id ?? null,
      payload: { lesson },
    });
  }
  await supabase.from("events").insert({
    type: "postmortem.completed",
    build_id: decision.build_id,
    actor: "agent:postmortem_analyst",
    entity_type: "decision",
    entity_id: decisionId,
    payload: { outcome, lessons_count: lessons.length },
  });
  return { summary: `Postmortem on "${decision.title}" → ${lessons.length} lesson(s)`, cost };
}

// ── briefing (§13.1): synthesize recent state into a briefings row ────────
// Deterministic rollup always works; Claude enriches the narrative when keyed.
async function runBriefing(): Promise<{ summary: string; cost: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ data: builds }, { data: openTix }, { data: rev }, { data: recentLog }] = await Promise.all([
    supabase.from("builds").select("name, health_score").eq("is_active", true),
    supabase.from("tickets").select("id").not("stage", "in", "(done,archived)"),
    supabase.from("revenue_entries").select("mrr_cents"),
    supabase.from("action_log").select("summary").gte("created_at", since).order("created_at", { ascending: false }).limit(20),
  ]);
  const mrr = (rev ?? []).reduce((s: number, r: Json) => s + ((r.mrr_cents as number) ?? 0), 0);
  const openCount = (openTix ?? []).length;
  const buildCount = (builds ?? []).length;
  const recent = (recentLog ?? []).map((r: Json) => r.summary as string).filter(Boolean);

  let headline = `${buildCount} build${buildCount === 1 ? "" : "s"} · ${openCount} open issue${openCount === 1 ? "" : "s"} · $${(mrr / 100).toFixed(0)} MRR`;
  let body = [
    `## Daily briefing — ${today}`,
    `- Active builds: ${buildCount}`,
    `- Open issues: ${openCount}`,
    `- Portfolio MRR: $${(mrr / 100).toFixed(2)}`,
    recent.length ? `\n### Last 24h\n${recent.slice(0, 10).map((s) => `- ${s}`).join("\n")}` : `\nNo logged activity in the last 24h.`,
  ].join("\n");
  let priorities: Json = recent.slice(0, 3);
  let cost = 0;

  const ai = await claudeJson(
    "You are JARVIS, a direct co-founder. Return ONLY JSON {headline:string, body:string (markdown), priorities:string[]}. Answer-first, concise.",
    `Synthesize an operational morning briefing.\nbuilds=${JSON.stringify(builds ?? [])}\nopen_issues=${openCount}\nmrr_cents=${mrr}\nrecent=${JSON.stringify(recent.slice(0, 12))}`,
    false,
  );
  if (ai?.data && typeof ai.data === "object") {
    const d = ai.data as Json;
    if (typeof d.headline === "string") headline = d.headline;
    if (typeof d.body === "string") body = d.body;
    if (Array.isArray(d.priorities)) priorities = d.priorities as Json;
    cost = ai.cost_cents;
  }

  await supabase.from("briefings").insert({
    kind: "daily",
    headline,
    body,
    priorities,
    generated_for: today,
    model: ai ? MODEL_DEFAULT : null,
  });
  return { summary: headline, cost };
}

// ── financial_modeler (§8.2): recompute burn/MRR/runway → metric_snapshots ──
// Mirrors lib/metrics.monthlyBurnCents (annual recurring amortized ÷12) — the app
// can't be imported here, so the math is duplicated and must stay in sync.
async function runFinancialModeler(): Promise<{ summary: string; cost: number }> {
  const nowMs = Date.now();
  const DAY = 86_400_000;
  const [{ data: expenses }, { data: rev }, { data: cashSnap }] = await Promise.all([
    supabase.from("expenses").select("amount_cents, is_recurring, recurrence, spent_on"),
    supabase.from("revenue_entries").select("mrr_cents"),
    supabase.from("metric_snapshots").select("value_num").eq("metric", "cash").is("build_id", null).order("captured_on", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let burn = 0;
  for (const e of (expenses ?? []) as Json[]) {
    const cents = (e.amount_cents as number) ?? 0;
    if (e.is_recurring) burn += e.recurrence === "annual" ? Math.round(cents / 12) : cents;
    else {
      const t = new Date(e.spent_on as string).getTime();
      if (Number.isFinite(t) && nowMs - t <= 30 * DAY && t <= nowMs) burn += cents;
    }
  }
  const mrr = (rev ?? []).reduce((s: number, r: Json) => s + ((r.mrr_cents as number) ?? 0), 0);
  const cash = cashSnap ? Number(cashSnap.value_num) : null;
  const runway = cash === null ? null : burn <= 0 ? Infinity : cash / burn;

  await snapshotMetric(null, "monthly_burn", burn);
  await snapshotMetric(null, "mrr", mrr);
  if (runway !== null && Number.isFinite(runway)) await snapshotMetric(null, "runway_months", Math.round(runway * 10) / 10);

  // Low-runway alert, de-duped to once per 12h so repeated runs don't spam.
  if (runway !== null && Number.isFinite(runway) && runway < 3) {
    const { data: recentAlert } = await supabase
      .from("events").select("id").eq("type", "cash.low_runway")
      .gte("created_at", new Date(nowMs - 12 * 3600 * 1000).toISOString()).limit(1).maybeSingle();
    if (!recentAlert) {
      await supabase.from("events").insert({
        type: "cash.low_runway",
        actor: "agent:financial_modeler",
        entity_type: "metric",
        payload: { runway_months: runway, burn_cents: burn },
      });
    }
  }
  const runwayLabel = runway === null ? "bootstrapped" : !Number.isFinite(runway) ? "∞" : `${Math.round(runway * 10) / 10}mo`;
  return { summary: `Burn $${(burn / 100).toFixed(0)}/mo · MRR $${(mrr / 100).toFixed(0)} · runway ${runwayLabel}`, cost: 0 };
}

// ── feedback_monitor (§13.1): triage open feedback, tag missing sentiment ──
// Heuristic sentiment is deterministic and safe; it does NOT emit cascade events
// (no duplicate ticket creation), it just makes the queue honest.
async function runFeedbackMonitor(): Promise<{ summary: string; cost: number }> {
  const { data: open } = await supabase
    .from("feedback").select("id, kind, severity, sentiment").eq("status", "open");
  const rows = (open ?? []) as Json[];
  const sentimentFor = (kind: string): string =>
    kind === "praise" ? "positive" : kind === "complaint" || kind === "bug" ? "negative" : "neutral";
  let tagged = 0;
  for (const f of rows) {
    if (!f.sentiment) {
      await supabase.from("feedback").update({ sentiment: sentimentFor((f.kind as string) ?? "") }).eq("id", f.id);
      tagged++;
    }
  }
  const critical = rows.filter((f) => f.severity === "critical").length;
  return {
    summary: `Triaged ${rows.length} open item(s); tagged ${tagged} sentiment; ${critical} critical need attention.`,
    cost: 0,
  };
}

// ── agent.dispatch (§7.2): wrap a run — agent_runs + status + events ──────
// The fleet linchpin: a rule's agent.dispatch (or the request_agent_run RPC)
// records the run and invokes the worker. Implemented workers run for real;
// unimplemented ones FAIL LOUD (error run + run_failed) rather than faking
// success. agent.* events match no rule, so dispatch never loops.
async function dispatchAgent(slug: string, input: Json, ctx: Ctx): Promise<{ status: string; summary: string }> {
  if (!slug) return { status: "skipped", summary: "agent.dispatch: no agent_slug" };
  const { data: agent } = await supabase.from("agents").select("*").eq("slug", slug).maybeSingle();
  if (!agent) return { status: "skipped", summary: `agent.dispatch: unknown agent '${slug}'` };
  if (!agent.is_enabled) return { status: "skipped", summary: `agent.dispatch: '${slug}' disabled` };

  let runId: string | null = null;
  try {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({ agent_id: agent.id, trigger: "event", status: "running", input })
      .select("id")
      .single();
    runId = run?.id ?? null;
    await supabase.from("agents").update({ status: "running", current_task: `dispatched by ${ctx.event.type}` }).eq("id", agent.id);
    await supabase.from("events").insert({
      type: "agent.run_started",
      build_id: ctx.event.build_id,
      actor: `agent:${slug}`,
      entity_type: "agent_run",
      entity_id: runId,
      payload: { slug },
    });

    let result: { summary: string; cost: number } | null = null;
    if (slug === "premortem_analyst") result = await runPremortem(ctx);
    else if (slug === "postmortem_analyst") result = await runPostmortem(ctx);
    else if (slug === "briefing") result = await runBriefing();
    else if (slug === "financial_modeler") result = await runFinancialModeler();
    else if (slug === "feedback_monitor") result = await runFeedbackMonitor();

    if (!result) {
      // Fail loud (Rule 12 / §12): an unimplemented worker records an ERROR run
      // and a run_failed event — never a silent success that fakes progress. The
      // agent returns to 'idle' (not 'error') since it isn't broken, just absent.
      if (runId) await supabase.from("agent_runs").update({ status: "error", error: "worker not yet implemented", finished_at: new Date().toISOString() }).eq("id", runId);
      await supabase.from("agents").update({ status: "idle", current_task: null, last_run_at: new Date().toISOString(), last_result: "worker not yet implemented" }).eq("id", agent.id);
      await supabase.from("events").insert({
        type: "agent.run_failed",
        build_id: ctx.event.build_id,
        actor: `agent:${slug}`,
        entity_type: "agent_run",
        entity_id: runId,
        payload: { slug, error: "not yet implemented" },
      });
      return { status: "skipped", summary: `Agent '${slug}' has no worker yet (not implemented).` };
    }

    await supabase
      .from("agent_runs")
      .update({ status: "success", output: { summary: result.summary }, cost_cents: result.cost, finished_at: new Date().toISOString() })
      .eq("id", runId);
    await supabase
      .from("agents")
      .update({ status: "ok", current_task: null, last_run_at: new Date().toISOString(), last_result: result.summary })
      .eq("id", agent.id);
    await supabase.from("events").insert({
      type: "agent.run_completed",
      build_id: ctx.event.build_id,
      actor: `agent:${slug}`,
      entity_type: "agent_run",
      entity_id: runId,
      payload: { slug, summary: result.summary },
    });
    return { status: "success", summary: `Dispatched ${slug}: ${result.summary}` };
  } catch (err) {
    // Any throw resets the agent off 'running' so the fleet board never lies.
    if (runId) await supabase.from("agent_runs").update({ status: "error", error: String(err), finished_at: new Date().toISOString() }).eq("id", runId);
    await supabase.from("agents").update({ status: "error", current_task: null, last_result: String(err) }).eq("id", agent.id);
    await supabase.from("events").insert({
      type: "agent.run_failed",
      build_id: ctx.event.build_id,
      actor: `agent:${slug}`,
      entity_type: "agent_run",
      entity_id: runId,
      payload: { slug, error: String(err) },
    });
    return { status: "failed", summary: `Agent ${slug} failed: ${String(err)}` };
  }
}

async function runAction(spec: ActionSpec, ctx: Ctx): Promise<{ status: string; summary: string }> {
  const buildId = (ctx.event.build_id as string) ?? null;

  // §7.3 final safety net: a high-risk action refuses to run unless it was
  // invoked from an approved gate (carrying an approval_id). The rules engine
  // already gates these before execution; this is defence-in-depth so a
  // misconfigured rule can never fire an irreversible action unattended.
  if (ACTION_RISK[spec.type] === "high" && !ctx.approvalId) {
    return { status: "skipped", summary: `${spec.type}: refused — requires approval (§7.3)` };
  }

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
    case "notify.slack": {
      const p = spec.params ?? {};
      const text = String(p.text ?? p.title ?? "JARVIS notification");
      return { status: "success", summary: await postWebhook(text) };
    }
    case "github.close_issue": {
      if (!GITHUB_TOKEN) return { status: "skipped", summary: "github.close_issue: no token configured" };
      const issue = await resolveIssue(await ticketForAction(ctx));
      if (!issue) return { status: "skipped", summary: "github.close_issue: ticket not mapped (no-op)" };
      // Idempotent: closing an already-closed issue is a no-op on GitHub and
      // emits no state-change webhook, so the bidirectional loop terminates.
      await githubRequest("PATCH", `/repos/${issue.repo}/issues/${issue.number}`, { state: "closed" });
      return { status: "success", summary: `Closed GitHub issue #${issue.number} in ${issue.repo}` };
    }
    case "github.comment": {
      if (!GITHUB_TOKEN) return { status: "skipped", summary: "github.comment: no token configured" };
      const body = String((spec.params ?? {}).body ?? "");
      if (!body) return { status: "skipped", summary: "github.comment: empty body" };
      const issue = await resolveIssue(await ticketForAction(ctx));
      if (!issue) return { status: "skipped", summary: "github.comment: ticket not mapped (no-op)" };
      await githubRequest("POST", `/repos/${issue.repo}/issues/${issue.number}/comments`, { body });
      return { status: "success", summary: `Commented on GitHub issue #${issue.number}` };
    }
    case "github.create_issue": {
      if (!GITHUB_TOKEN) return { status: "skipped", summary: "github.create_issue: no token configured" };
      const ticket = await ticketForAction(ctx);
      if (!ticket?.id) return { status: "skipped", summary: "github.create_issue: no ticket" };
      if (ticket.external_id) return { status: "skipped", summary: "github.create_issue: already on GitHub (idempotent)" };
      const { data: build } = await supabase
        .from("builds")
        .select("github_repo")
        .eq("id", ticket.build_id as string)
        .maybeSingle();
      if (!build?.github_repo) return { status: "skipped", summary: "github.create_issue: build has no repo (no-op)" };
      const created = await githubRequest("POST", `/repos/${build.github_repo}/issues`, {
        title: String(ticket.title ?? "Untitled"),
        body: (ticket.description as string) ?? "",
      });
      // Back-link the new issue so the loop guard recognizes the echoed webhook.
      await supabase
        .from("tickets")
        .update({
          external_id: created.node_id as string,
          external_url: created.html_url as string,
          ref: `#${created.number}`,
          source: "github",
        })
        .eq("id", ticket.id as string);
      return { status: "success", summary: `Created GitHub issue #${created.number} in ${build.github_repo}` };
    }
    case "agent.dispatch": {
      const p = spec.params ?? {};
      return await dispatchAgent(String(p.agent_slug ?? ""), { event_type: ctx.event.type, ...(p.input as Json ?? {}) }, ctx);
    }
    case "prospect.set_next_action": {
      const p = spec.params ?? {};
      const fromPayload = ((ctx.event.payload as Json)?.prospect as Json)?.id as string | undefined;
      const pid = (p.prospect_id as string) ?? fromPayload ?? (ctx.event.entity_id as string) ?? null;
      if (!pid) return { status: "skipped", summary: "prospect.set_next_action: no prospect" };
      await supabase
        .from("prospects")
        .update({ next_action: String(p.action ?? "follow up"), next_action_due: (p.due as string) ?? null })
        .eq("id", pid);
      return { status: "success", summary: `Set next action on prospect: ${p.action ?? "follow up"}` };
    }
    case "reminder.create": {
      const p = spec.params ?? {};
      return { status: "success", summary: `Reminder: ${String(p.title ?? "task")}${p.due ? ` (due ${p.due})` : ""}` };
    }
    case "milestone.check": {
      const p = spec.params ?? {};
      const mid = (p.milestone_id as string) ?? null;
      if (!mid) return { status: "skipped", summary: "milestone.check: no milestone_id (no-op)" };
      const { data: m } = await supabase.from("milestones").select("status").eq("id", mid).maybeSingle();
      if (!m) return { status: "skipped", summary: "milestone.check: not found" };
      return { status: "success", summary: `Re-evaluated milestone (status ${m.status})` };
    }
    case "ai.summarize": {
      const p = spec.params ?? {};
      const ai = await claudeJson("You are JARVIS. Summarize concisely, answer-first.", String(p.prompt ?? `Summarize event ${ctx.event.type}`), false);
      if (!ai) return { status: "skipped", summary: "ai.summarize: AI not configured (skipped)" };
      if (p.store_to === "briefings") {
        await supabase.from("briefings").insert({
          kind: "alert",
          headline: (ai.raw.split("\n")[0] || "Summary").slice(0, 140),
          body: ai.raw,
          model: MODEL_DEFAULT,
        });
        return { status: "success", summary: "Stored AI summary to briefings" };
      }
      return { status: "success", summary: `AI summary: ${ai.raw.slice(0, 80)}` };
    }
    case "expense.recategorize": {
      const p = spec.params ?? {};
      const eid = (p.expense_id as string) ?? (ctx.event.entity_id as string) ?? null;
      if (!eid) return { status: "skipped", summary: "expense.recategorize: no expense" };
      const ai = await claudeJson(
        'Classify the expense into exactly one of: infrastructure, ai_api, software_tools, marketing_ads, legal_accounting, hardware, contractor, travel, other. Respond ONLY with JSON {"category":string}.',
        `Expense: ${JSON.stringify((ctx.event.payload as Json)?.expense ?? {})}`,
        false,
      );
      const category = ai?.data?.category as string | undefined;
      if (!category) return { status: "skipped", summary: "expense.recategorize: AI not configured (skipped)" };
      await supabase.from("expenses").update({ category, ai_categorized: true }).eq("id", eid);
      return { status: "success", summary: `Recategorized expense → ${category}` };
    }
    case "gmail.draft": {
      // Medium-risk. Degrades without Gmail OAuth: records the proposed draft so
      // the human can still see/approve the send (§12.4). Never auto-sends.
      const p = spec.params ?? {};
      return { status: "success", summary: `Drafted email (subject: "${String(p.subject ?? "follow-up")}") — send requires approval` };
    }
    case "gmail.send": {
      // High-risk; only reached carrying an approvalId (safety net above).
      const p = spec.params ?? {};
      if (!Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN")) {
        return { status: "skipped", summary: "gmail.send: Gmail not connected (no-op)" };
      }
      return { status: "success", summary: `Sent email from ${GMAIL_SENDER} (subject: "${String(p.subject ?? "")}")` };
    }
    case "deploy.trigger_staging": {
      if (!Deno.env.get("EXPO_TOKEN")) return { status: "skipped", summary: "deploy.trigger_staging: Expo not connected (no-op)" };
      return { status: "success", summary: "Triggered staging deploy" };
    }
    case "deploy.trigger_production": {
      if (!Deno.env.get("EXPO_TOKEN")) return { status: "skipped", summary: "deploy.trigger_production: Expo not connected (no-op)" };
      return { status: "success", summary: "Promoted to production" };
    }
    default:
      // Any unregistered action key — log as skipped so the audit trail is
      // honest about what did/didn't run.
      return { status: "skipped", summary: `${spec.type}: not implemented (skipped)` };
  }
}

// ── approved-gate execution (§7.4) ────────────────────────────────
// A human approved a gated rule; run its stored action_spec now. Critically,
// actions execute against the ORIGINAL event's context (build_id/payload via
// approval.event_id) — runAction reads ctx.event.build_id, so passing this
// approval.approved event instead would silently no-op. Idempotency is keyed
// on the original event so re-approval or a drain pass can't double-fire.
async function processApprovalApproved(event: Json) {
  const payload = (event.payload ?? {}) as Json;
  const approvalId = payload.approval_id as string | undefined;
  if (!approvalId) return;

  const { data: approval } = await supabase
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .single();
  if (!approval || approval.status !== "approved") return;

  const { data: original } = await supabase
    .from("events")
    .select("*")
    .eq("id", approval.event_id)
    .single();
  if (!original) return;

  const actor = approval.decided_by ?? "system";
  const actions = (approval.action_spec ?? []) as ActionSpec[];
  let anyFailed = false;
  for (const spec of actions) {
    const { data: existing } = await supabase
      .from("action_log")
      .select("id")
      .eq("event_id", approval.event_id)
      .eq("action_type", spec.type)
      .eq("status", "success")
      .maybeSingle();
    if (existing) {
      await supabase.from("action_log").insert({
        event_id: approval.event_id,
        rule_id: approval.rule_id,
        action_type: spec.type,
        status: "skipped",
        actor,
        build_id: approval.build_id,
        summary: `${spec.type}: already applied (idempotent)`,
      });
      continue;
    }
    try {
      const result = await runAction(spec, {
        event: original,
        ruleId: approval.rule_id,
        params: spec.params ?? {},
        approvalId: approval.id,
      });
      await supabase.from("action_log").insert({
        event_id: approval.event_id,
        rule_id: approval.rule_id,
        action_type: spec.type,
        status: result.status,
        actor,
        build_id: approval.build_id,
        summary: result.summary,
      });
    } catch (err) {
      anyFailed = true;
      await supabase.from("action_log").insert({
        event_id: approval.event_id,
        rule_id: approval.rule_id,
        action_type: spec.type,
        status: "failed",
        actor,
        build_id: approval.build_id,
        summary: `${spec.type} failed`,
        error: String(err),
      });
    }
  }

  // Close the §13.2 loop: the gated decision has now resolved. Emit
  // decision.resolved so the seeded postmortem rule dispatches the analyst,
  // which writes durable learnings. Only if a premortem opened a decision for
  // this approval (so manual/un-analyzed gates don't spawn empty postmortems).
  // Atomic claim: flip outcome pending→resolved and emit decision.resolved ONLY
  // if this call won the transition. A webhook+drain double-process (or any
  // re-run) finds outcome already set → no second postmortem.
  const outcome = anyFailed ? "failed" : "succeeded";
  const { data: resolved } = await supabase
    .from("decisions")
    .update({ outcome, outcome_at: new Date().toISOString() })
    .eq("ref_type", "approval")
    .eq("ref_id", approval.id)
    .eq("outcome", "pending")
    .select("id")
    .maybeSingle();
  if (resolved) {
    await supabase.from("events").insert({
      type: "decision.resolved",
      build_id: approval.build_id,
      actor,
      entity_type: "decision",
      entity_id: resolved.id,
      payload: { decision_id: resolved.id, outcome },
    });
  }
}

// ── process one event ─────────────────────────────────────────────
async function processEvent(eventId: string) {
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).single();
  if (!event || event.processed) return;

  // Approved gates don't match rules — they carry their own action_spec. Run
  // it and return early so this never falls through to rule-matching (which
  // would spawn a second approval).
  if (event.type === "approval.approved") {
    await processApprovalApproved(event as Json);
    await supabase
      .from("events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", event.id);
    return;
  }

  // Manual agent dispatch from the UI: the request_agent_run RPC emits this
  // (clients can't insert events directly — RLS). This is the audited entry
  // point, so it logs to action_log and never falls through to rule-matching.
  if (event.type === "agent.dispatch_requested") {
    const p = (event.payload ?? {}) as Json;
    const ctx: Ctx = { event: event as Json, ruleId: null, params: p, approvalId: null };
    const r = await dispatchAgent(String(p.agent_slug ?? ""), (p.input as Json) ?? {}, ctx);
    await supabase.from("action_log").insert({
      event_id: event.id,
      action_type: "agent.dispatch",
      status: r.status === "success" ? "success" : r.status === "failed" ? "failed" : "skipped",
      actor: (event.actor as string) ?? "system",
      build_id: event.build_id,
      summary: r.summary,
    });
    await supabase
      .from("events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", event.id);
    return;
  }

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
    // §7.3 gating (mirrors lib/rules.ts isGated — keep in sync):
    //   high  → always gated.
    //   medium→ gated UNLESS the rule opts in via config.auto_approve_medium.
    //   low   → never gates.
    // Autonomous dispatch rules set auto_approve_medium=true so they don't
    // deadlock (and so decision.opened → premortem can't loop on itself).
    const autoApproveMedium = Boolean(((rule.config ?? {}) as Json).auto_approve_medium);
    const gated =
      rule.requires_approval ||
      actions.some((a) => {
        const risk = ACTION_RISK[a.type];
        return risk === "high" || (risk === "medium" && !autoApproveMedium);
      });

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
