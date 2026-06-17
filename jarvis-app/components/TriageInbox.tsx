"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApprovals, useTickets, useFeedback, useBuilds } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { buildTriageItems, type TriageCategory, type TriageItem } from "@/lib/triage";

// A read-only triage inbox: everything across the studio that's waiting on a
// human, normalized into one stream and grouped by what kind of attention it
// needs. Sources are existing tables (approvals, tickets, feedback) — no new
// write paths. `tickets.source`/`feedback.source` already carry 'github', so
// externally-synced items will appear here once that wiring lands (Phase 2+).
// The merge/categorize/sort logic lives in lib/triage.ts (unit-tested).

const CATEGORY_META: Record<TriageCategory, { label: string; tone: "amber" | "cyan" | "red" | "green" | "muted" }> = {
  decision: { label: "Decision", tone: "amber" },
  review: { label: "Review", tone: "cyan" },
  bug: { label: "Fix", tone: "red" },
  feature: { label: "Feature", tone: "green" },
  feedback: { label: "Feedback", tone: "muted" },
};

export function TriageInbox() {
  const approvals = useApprovals();
  const tickets = useTickets();
  const feedback = useFeedback();
  const builds = useBuilds();
  const [filter, setFilter] = useState<TriageCategory | "all">("all");

  const buildColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of builds.data ?? []) m.set(b.id, b.color);
    return m;
  }, [builds.data]);

  const items = useMemo(
    () => buildTriageItems(approvals.data ?? [], tickets.data ?? [], feedback.data ?? []),
    [approvals.data, tickets.data, feedback.data],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const it of items) c[it.category] = (c[it.category] ?? 0) + 1;
    return c;
  }, [items]);

  const visible = filter === "all" ? items : items.filter((it) => it.category === filter);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionTitle>Needs Attention</SectionTitle>
        <Badge tone={items.length ? "amber" : "muted"}>{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted-hi)]">
            Nothing needs your attention right now. Pending approvals, tickets in
            review, and incoming work from Claude or GitHub will surface here.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>
              All
            </FilterChip>
            {(Object.keys(CATEGORY_META) as TriageCategory[])
              .filter((c) => counts[c])
              .map((c) => (
                <FilterChip
                  key={c}
                  active={filter === c}
                  onClick={() => setFilter(c)}
                  count={counts[c]}
                >
                  {CATEGORY_META[c].label}
                </FilterChip>
              ))}
          </div>

          <Card className="divide-y divide-[var(--glass-border)] p-0">
            {visible.map((it) => (
              <Row key={it.id} item={it} color={it.buildId ? buildColor.get(it.buildId) : undefined} />
            ))}
          </Card>
        </>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
        active
          ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
          : "border-[var(--glass-border-2)] text-[var(--muted-hi)] hover:text-[var(--white)]"
      }`}
    >
      {children} <span className="opacity-60">{count}</span>
    </button>
  );
}

function Row({ item, color }: { item: TriageItem; color?: string }) {
  const meta = CATEGORY_META[item.category];
  const inner = (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Badge tone={meta.tone}>{meta.label}</Badge>
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--white)]">{item.title}</span>
      <span className="hidden font-mono text-[10px] text-[var(--muted-hi)] sm:inline">{item.source}</span>
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="font-mono text-[10px] text-[var(--muted)]">{timeAgo(item.at)}</span>
    </div>
  );
  if (!item.href) return inner;
  return (
    <Link href={item.href} className="block transition-colors hover:bg-[var(--glass-border)]/40">
      {inner}
    </Link>
  );
}
