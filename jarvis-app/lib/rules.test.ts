import { describe, it, expect } from "vitest";
import {
  evalCondition,
  conditionsPass,
  ruleMatches,
  isGated,
  computeHealth,
  type Condition,
} from "./rules";

// Tests encode WHY each behavior matters, not just what it does.

describe("evalCondition — operators resolve dot-paths against the event payload", () => {
  const payload = {
    to_stage: "done",
    from_stage: "review",
    ticket: { priority: "high", is_blocker: true, labels: ["urgent"] },
  };

  it("matches the ticket-done rule trigger so the cascade only fires on done", () => {
    expect(evalCondition({ field: "to_stage", op: "eq", value: "done" }, payload)).toBe(true);
    expect(evalCondition({ field: "to_stage", op: "eq", value: "review" }, payload)).toBe(false);
  });

  it("reads nested fields so blocker rules can inspect the ticket", () => {
    expect(evalCondition({ field: "ticket.is_blocker", op: "eq", value: true }, payload)).toBe(true);
    expect(evalCondition({ field: "ticket.priority", op: "in", value: ["high", "critical"] }, payload)).toBe(true);
  });

  it("supports contains/exists for label- and presence-based rules", () => {
    expect(evalCondition({ field: "ticket.labels", op: "contains", value: "urgent" }, payload)).toBe(true);
    expect(evalCondition({ field: "ticket.external_id", op: "exists", value: null }, payload)).toBe(false);
  });

  it("changed_to/changed_from let rules react to transitions, not just states", () => {
    expect(evalCondition({ field: "x", op: "changed_to", value: "done" }, payload)).toBe(true);
    expect(evalCondition({ field: "x", op: "changed_from", value: "review" }, payload)).toBe(true);
  });
});

describe("conditionsPass — implicit AND prevents a rule firing on partial matches", () => {
  it("requires every condition (a blocker reaching done, not just any done)", () => {
    const conds: Condition[] = [
      { field: "ticket.is_blocker", op: "eq", value: true },
      { field: "to_stage", op: "eq", value: "done" },
    ];
    expect(conditionsPass(conds, { to_stage: "done", ticket: { is_blocker: true } })).toBe(true);
    expect(conditionsPass(conds, { to_stage: "done", ticket: { is_blocker: false } })).toBe(false);
  });
});

describe("ruleMatches — wildcard lets one rule cover a whole entity family", () => {
  it("matches exact and trailing-wildcard triggers but not unrelated events", () => {
    expect(ruleMatches("ticket.advanced", "ticket.advanced")).toBe(true);
    expect(ruleMatches("ticket.*", "ticket.advanced")).toBe(true);
    expect(ruleMatches("ticket.*", "prospect.replied")).toBe(false);
  });
});

describe("isGated — high-risk actions must never auto-execute (safety net, §7.3)", () => {
  it("gates when approval is required OR any action is high-risk, even if others are low", () => {
    expect(isGated(false, [{ type: "notify.push" }])).toBe(false);
    expect(isGated(true, [{ type: "notify.push" }])).toBe(true);
    expect(isGated(false, [{ type: "notify.push" }, { type: "gmail.send" }])).toBe(true);
    expect(isGated(false, [{ type: "deploy.trigger_production" }])).toBe(true);
  });

  it("gates medium-risk actions by default (gmail.draft, agent.dispatch)", () => {
    expect(isGated(false, [{ type: "gmail.draft" }])).toBe(true);
    expect(isGated(false, [{ type: "agent.dispatch" }])).toBe(true);
  });

  it("auto_approve_medium lets medium run, but NEVER lets high through", () => {
    expect(isGated(false, [{ type: "agent.dispatch" }], true)).toBe(false);
    expect(isGated(false, [{ type: "gmail.draft" }], true)).toBe(false);
    // high stays gated even with the opt-in — §7.3 is absolute for high.
    expect(isGated(false, [{ type: "agent.dispatch" }, { type: "gmail.send" }], true)).toBe(true);
  });

  it("LOOP GUARD: a decision.opened → premortem dispatch must NOT gate", () => {
    // If this gated, it would create an approval → emit a new decision.opened →
    // match again → runaway. The seed sets auto_approve_medium=true for exactly
    // this class of autonomous dispatch rule.
    expect(isGated(false, [{ type: "agent.dispatch", params: { agent_slug: "premortem_analyst" } }], true)).toBe(false);
  });
});

describe("computeHealth — deterministic score the AI can explain but not invent (§8.1)", () => {
  it("is bounded 0–100", () => {
    expect(computeHealth({ tickets: [], mrrCents: 0 })).toBeGreaterThanOrEqual(0);
    expect(computeHealth({ tickets: [], mrrCents: 0 })).toBeLessThanOrEqual(100);
  });

  it("rewards delivery + revenue and penalizes open critical bugs", () => {
    const healthy = computeHealth({
      tickets: [
        { stage: "done", priority: "medium", type: "feature" },
        { stage: "done", priority: "low", type: "chore" },
      ],
      mrrCents: 5000,
    });
    const sick = computeHealth({
      tickets: [
        { stage: "backlog", priority: "critical", type: "bug" },
        { stage: "backlog", priority: "critical", type: "bug" },
      ],
      mrrCents: 0,
    });
    expect(healthy).toBeGreaterThan(sick);
  });
});
