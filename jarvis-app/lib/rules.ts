// Canonical, pure rules-engine + health-score logic (spec §6.4, §7.3, §8.1).
// The event-processor Edge Function (Deno) mirrors this exact logic; it cannot
// import from the app at deploy time, so this file is the tested reference and
// any change must be reflected there. Keeping it pure makes it unit-testable.

export type Op =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "contains" | "exists" | "changed_to" | "changed_from";
export type Condition = { field: string; op: Op; value: unknown };
export type ActionSpec = { type: string; params?: Record<string, unknown> };
type Json = Record<string, unknown>;

export function resolve(path: string, payload: Json): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Json)) {
      return (acc as Json)[key];
    }
    return undefined;
  }, payload);
}

export function evalCondition(c: Condition, payload: Json): boolean {
  const actual = resolve(c.field, payload);
  switch (c.op) {
    case "eq": return actual === c.value;
    case "neq": return actual !== c.value;
    case "gt": return Number(actual) > Number(c.value);
    case "gte": return Number(actual) >= Number(c.value);
    case "lt": return Number(actual) < Number(c.value);
    case "lte": return Number(actual) <= Number(c.value);
    case "in": return Array.isArray(c.value) && (c.value as unknown[]).includes(actual);
    case "contains": return Array.isArray(actual) && actual.includes(c.value);
    case "exists": return actual !== undefined && actual !== null;
    case "changed_to":
      return resolve("to_stage", payload) === c.value || resolve("to_status", payload) === c.value;
    case "changed_from":
      return resolve("from_stage", payload) === c.value || resolve("from_status", payload) === c.value;
    default: return false;
  }
}

/** ALL conditions must pass (implicit AND, §6.4). */
export function conditionsPass(conditions: Condition[], payload: Json): boolean {
  return conditions.every((c) => evalCondition(c, payload));
}

/** Trigger match with trailing-wildcard support (e.g. "ticket.*"). */
export function ruleMatches(triggerEvent: string, eventType: string): boolean {
  if (triggerEvent.endsWith("*")) return eventType.startsWith(triggerEvent.slice(0, -1));
  return triggerEvent === eventType;
}

export const ACTION_RISK: Record<string, "low" | "medium" | "high"> = {
  "health.recompute": "low", "metric.snapshot": "low", "notify.push": "low",
  "notify.slack": "low", "prospect.set_next_action": "low", "reminder.create": "low",
  "milestone.check": "low", "ai.summarize": "low", "expense.recategorize": "low",
  "github.close_issue": "low", "github.comment": "low", "github.create_issue": "low",
  "gmail.draft": "medium", "deploy.trigger_staging": "medium", "agent.dispatch": "medium",
  "gmail.send": "high", "deploy.trigger_production": "high",
};

/** A rule gates (§7.3) if it requires approval, OR contains any high-risk action
 *  (always gated, regardless of config), OR contains a medium-risk action while
 *  the rule has NOT opted into `auto_approve_medium`. Low-risk never gates.
 *
 *  `autoApproveMedium` lets autonomous dispatch rules (e.g. decision.opened →
 *  premortem) run their medium dispatch automatically — gating that dispatch
 *  would both deadlock the analyst fleet and create a decision.opened loop. The
 *  high-risk *output* an agent proposes is still gated separately. */
export function isGated(
  requiresApproval: boolean,
  actions: ActionSpec[],
  autoApproveMedium = false,
): boolean {
  if (requiresApproval) return true;
  return actions.some((a) => {
    const risk = ACTION_RISK[a.type];
    if (risk === "high") return true;
    if (risk === "medium") return !autoApproveMedium;
    return false;
  });
}

export type HealthInput = {
  tickets: { stage: string; priority: string; type: string }[];
  mrrCents: number;
};

/** Deterministic 0–100 health score (§8.1). */
export function computeHealth({ tickets, mrrCents }: HealthInput): number {
  const opened = tickets.length || 1;
  const done = tickets.filter((t) => t.stage === "done" || t.stage === "archived").length;
  const delivery = (done / opened) * 100;

  const openCritBugs = tickets.filter(
    (t) => t.priority === "critical" && t.stage !== "done" && t.stage !== "archived",
  ).length;
  const quality = Math.max(0, 100 - openCritBugs * 15);

  const inFlight = tickets.filter((t) => t.stage === "in_progress" || t.stage === "review").length;
  const momentum = Math.min(100, inFlight * 20);

  const openInfraSec = tickets.filter(
    (t) => (t.type === "infra" || t.type === "security") && t.priority === "high" && t.stage !== "done",
  ).length;
  const techDebt = Math.max(0, 100 - openInfraSec * 20);

  const revenueSig = mrrCents > 0 ? 100 : 30;

  return Math.round(
    Math.max(0, Math.min(100,
      0.3 * delivery + 0.2 * quality + 0.2 * momentum + 0.15 * techDebt + 0.15 * revenueSig)),
  );
}
