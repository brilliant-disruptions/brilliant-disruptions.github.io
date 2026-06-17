// Pure normalization for the Overview "Needs Attention" inbox: merge everything
// across the studio that's waiting on a human (pending approvals, tickets in
// review, untriaged incoming work, open feedback) into one categorized,
// urgency-sorted stream. No React, no I/O — unit-tested in triage.test.ts.
import type { Tables } from "@/lib/database.types";

export type TriageCategory = "decision" | "review" | "bug" | "feature" | "feedback";

export type TriageItem = {
  id: string;
  category: TriageCategory;
  title: string;
  buildId: string | null;
  source: string; // short provenance label: "Claude", "You", "GitHub", "high risk", …
  href: string | null;
  at: string;
};

// Decisions are most urgent (a gated action is blocked on a human); feedback is
// least. Drives the default sort within the merged stream.
const URGENCY: Record<TriageCategory, number> = {
  decision: 0,
  review: 1,
  bug: 2,
  feature: 3,
  feedback: 4,
};

const TICKET_SOURCE_LABEL: Record<string, string> = {
  manual: "You",
  agent: "Claude", // the agent fleet is Claude-driven (matches the user's mental model)
  github: "GitHub",
};

export function prettySource(raw: string): string {
  return raw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function fromApprovals(rows: Tables<"approvals">[]): TriageItem[] {
  return rows.map((a) => ({
    id: `approval:${a.id}`,
    category: "decision" as const,
    title: a.title,
    buildId: a.build_id,
    source: `${a.risk} risk`,
    href: "/activity",
    at: a.created_at,
  }));
}

function fromTickets(rows: Tables<"tickets">[]): TriageItem[] {
  const items: TriageItem[] = [];
  for (const t of rows) {
    let category: TriageCategory | null = null;
    if (t.stage === "review") {
      category = "review";
    } else if ((t.source === "agent" || t.source === "github") && t.stage === "backlog") {
      // Incoming, untriaged work from Claude or an external sync.
      category = t.type === "feature" ? "feature" : "bug";
    }
    if (!category) continue;
    items.push({
      id: `ticket:${t.id}`,
      category,
      title: t.title,
      buildId: t.build_id,
      source: TICKET_SOURCE_LABEL[t.source] ?? prettySource(t.source),
      href: "/engineering",
      at: t.stage_changed_at,
    });
  }
  return items;
}

function fromFeedback(rows: Tables<"feedback">[]): TriageItem[] {
  return rows
    // Skip feedback already converted to a ticket — that ticket carries it now,
    // so showing both would double-list one logical item.
    .filter((f) => f.status === "open" && !f.linked_ticket_id)
    .map((f) => ({
      id: `feedback:${f.id}`,
      category:
        f.kind === "feature" ? ("feature" as const) : f.kind === "bug" ? ("bug" as const) : ("feedback" as const),
      title: f.summary,
      buildId: f.build_id,
      source: prettySource(f.source),
      href: "/customers",
      at: f.created_at,
    }));
}

/** Merge the three sources into one stream, sorted by urgency then recency. */
export function buildTriageItems(
  approvals: Tables<"approvals">[],
  tickets: Tables<"tickets">[],
  feedback: Tables<"feedback">[],
): TriageItem[] {
  const merged = [...fromApprovals(approvals), ...fromTickets(tickets), ...fromFeedback(feedback)];
  merged.sort(
    (a, b) =>
      URGENCY[a.category] - URGENCY[b.category] ||
      new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  return merged;
}
