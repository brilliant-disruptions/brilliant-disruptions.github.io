import { describe, it, expect } from "vitest";
import { buildTriageItems, prettySource } from "./triage";
import type { Tables } from "./database.types";

// Tests encode WHY each behavior matters: the inbox's value is that it surfaces
// exactly the things blocked on a human and nothing else. A miscategorized or
// silently-dropped item defeats the whole point, so the filtering + bucketing
// rules are pinned here.

const ticket = (o: Partial<Tables<"tickets">>): Tables<"tickets"> =>
  ({
    id: o.title ?? "t",
    build_id: "b1",
    source: "manual",
    title: "ticket",
    type: "bug",
    stage: "backlog",
    stage_changed_at: "2026-01-01T00:00:00Z",
    ...o,
  }) as unknown as Tables<"tickets">;

const feedback = (o: Partial<Tables<"feedback">>): Tables<"feedback"> =>
  ({
    id: o.summary ?? "f",
    build_id: "b1",
    source: "beta_user",
    kind: "praise",
    summary: "feedback",
    status: "open",
    linked_ticket_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...o,
  }) as unknown as Tables<"feedback">;

const approval = (o: Partial<Tables<"approvals">>): Tables<"approvals"> =>
  ({
    id: o.title ?? "a",
    build_id: "b1",
    title: "approval",
    risk: "high",
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    ...o,
  }) as unknown as Tables<"approvals">;

describe("tickets surface only when they're actually waiting on someone", () => {
  it("includes a ticket parked in review", () => {
    const [item] = buildTriageItems([], [ticket({ stage: "review" })], []);
    expect(item.category).toBe("review");
    expect(item.href).toBe("/engineering");
  });

  it("buckets untriaged incoming agent/github work as feature vs fix by type", () => {
    const items = buildTriageItems(
      [],
      [
        ticket({ title: "feat", source: "agent", stage: "backlog", type: "feature" }),
        ticket({ title: "perf", source: "agent", stage: "backlog", type: "perf" }),
        ticket({ title: "gh", source: "github", stage: "backlog", type: "bug" }),
      ],
      [],
    );
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(byTitle.feat.category).toBe("feature");
    expect(byTitle.feat.source).toBe("Claude");
    expect(byTitle.perf.category).toBe("bug"); // non-feature incoming work is a fix
    expect(byTitle.gh.source).toBe("GitHub");
  });

  it("excludes work that is NOT awaiting a human: done, in-progress, and human-authored backlog", () => {
    const items = buildTriageItems(
      [],
      [
        ticket({ stage: "done", source: "agent" }),
        ticket({ stage: "in_progress", source: "agent" }),
        ticket({ stage: "backlog", source: "manual" }), // a human's own backlog isn't an inbox item
      ],
      [],
    );
    expect(items).toHaveLength(0);
  });
});

describe("feedback de-duplication", () => {
  it("drops open feedback already linked to a ticket so one item isn't listed twice", () => {
    const items = buildTriageItems(
      [],
      [],
      [feedback({ summary: "linked", linked_ticket_id: "t1" }), feedback({ summary: "fresh" })],
    );
    expect(items.map((i) => i.title)).toEqual(["fresh"]);
  });

  it("only shows open feedback, mapping kind to the matching bucket", () => {
    const items = buildTriageItems(
      [],
      [],
      [
        feedback({ summary: "resolved", status: "resolved" }),
        feedback({ summary: "wanted", kind: "feature" }),
        feedback({ summary: "broken", kind: "bug" }),
        feedback({ summary: "loved", kind: "praise" }),
      ],
    );
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i.category]));
    expect(byTitle.resolved).toBeUndefined();
    expect(byTitle.wanted).toBe("feature");
    expect(byTitle.broken).toBe("bug");
    expect(byTitle.loved).toBe("feedback");
  });
});

describe("ordering puts the most blocking work first", () => {
  it("sorts decision > review > fix > feature > feedback, newest first within a bucket", () => {
    const items = buildTriageItems(
      [approval({})],
      [
        ticket({ title: "older-review", stage: "review", stage_changed_at: "2026-01-01T00:00:00Z" }),
        ticket({ title: "newer-review", stage: "review", stage_changed_at: "2026-02-01T00:00:00Z" }),
        ticket({ title: "feat", source: "agent", stage: "backlog", type: "feature" }),
      ],
      [feedback({})],
    );
    expect(items.map((i) => i.category)).toEqual([
      "decision",
      "review",
      "review",
      "feature",
      "feedback",
    ]);
    // recency tiebreak inside the review bucket
    expect(items[1].title).toBe("newer-review");
  });

  it("labels a pending approval as a decision carrying its risk tier", () => {
    const [item] = buildTriageItems([approval({ risk: "high" })], [], []);
    expect(item.category).toBe("decision");
    expect(item.source).toBe("high risk");
    expect(item.id.startsWith("approval:")).toBe(true);
  });
});

describe("prettySource", () => {
  it("humanizes snake_case provenance for display", () => {
    expect(prettySource("beta_user")).toBe("Beta User");
    expect(prettySource("app_store")).toBe("App Store");
  });
});
