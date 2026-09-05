"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { useEvents } from "@/lib/queries/hooks";
import { Card, MetricCard, SectionTitle } from "@/components/ui";
import { TICKET_COLUMNS } from "@/lib/board-constants";
import type { Tables } from "@/lib/database.types";

type Ticket = Tables<"tickets">;

/** Cycle-time and cumulative-flow analytics, derived from the `events` table's
 *  ticket.advanced entries (the same audit trail advance_ticket already writes
 *  for the rules engine) — no separate status-history table needed. */
export function EngineeringAnalytics({ tickets }: { tickets: Ticket[] }) {
  const events = useEvents(500);

  const advances = useMemo(
    () =>
      (events.data ?? [])
        .filter((e) => e.type === "ticket.advanced")
        .map((e) => e.payload as { from_stage: string; to_stage: string; ticket: Ticket })
        .filter((p) => p?.ticket),
    [events.data],
  );

  const cycleTimeData = useMemo(() => {
    const firstSeen = new Map<string, number>();
    const byStageTotals = new Map<string, { total: number; count: number }>();
    for (const e of [...advances].reverse()) {
      const id = e.ticket.id;
      const t = new Date(e.ticket.stage_changed_at ?? e.ticket.updated_at).getTime();
      const prevTime = firstSeen.get(id) ?? t;
      const durationHrs = (t - prevTime) / 3_600_000;
      if (durationHrs > 0) {
        const bucket = byStageTotals.get(e.from_stage) ?? { total: 0, count: 0 };
        bucket.total += durationHrs;
        bucket.count += 1;
        byStageTotals.set(e.from_stage, bucket);
      }
      firstSeen.set(id, t);
    }
    return TICKET_COLUMNS.map((c) => {
      const b = byStageTotals.get(c.key);
      return { stage: c.label, avgHours: b ? Math.round(b.total / b.count) : 0 };
    });
  }, [advances]);

  const flowData = useMemo(() => {
    const days = 14;
    const today = new Date();
    const buckets: { date: string; backlog: number; in_progress: number; review: number; done: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const cutoff = d.getTime();
      const counts = { backlog: 0, in_progress: 0, review: 0, done: 0 } as Record<string, number>;
      for (const t of tickets) {
        const created = new Date(t.created_at).getTime();
        if (created > cutoff) continue;
        const stageAtCutoff =
          [...advances]
            .filter((a) => a.ticket.id === t.id && new Date(a.ticket.stage_changed_at).getTime() <= cutoff)
            .sort(
              (a, b) => new Date(b.ticket.stage_changed_at).getTime() - new Date(a.ticket.stage_changed_at).getTime(),
            )[0]?.to_stage ?? (created <= cutoff ? "backlog" : null);
        if (stageAtCutoff && stageAtCutoff in counts) counts[stageAtCutoff] += 1;
      }
      buckets.push({ date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), ...counts } as never);
    }
    return buckets;
  }, [tickets, advances]);

  // "Last 14 days" is inherently wall-clock-relative, so recomputing against
  // Date.now() on every render is correct here, not a purity bug.
  const doneLast14 = tickets.filter((t) => {
    if (t.stage !== "done" || !t.closed_at) return false;
    // eslint-disable-next-line react-hooks/purity
    return Date.now() - new Date(t.closed_at).getTime() < 14 * 86_400_000;
  }).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Throughput (14d)" value={doneLast14} sub="tickets closed" />
        <MetricCard label="Tracked moves" value={advances.length} />
        <MetricCard label="Open tickets" value={tickets.filter((t) => t.stage !== "done" && t.stage !== "archived").length} />
      </div>

      <Card>
        <SectionTitle>Avg time in stage</SectionTitle>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cycleTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border-2)" />
              <XAxis dataKey="stage" tick={{ fill: "var(--muted-hi)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--muted-hi)", fontSize: 11 }} label={{ value: "hours", angle: -90, position: "insideLeft", fill: "var(--muted-hi)" }} />
              <Tooltip contentStyle={{ background: "var(--elevated)", border: "1px solid var(--glass-border-2)" }} />
              <Bar dataKey="avgHours" fill="var(--indigo)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <SectionTitle>Cumulative flow (14d)</SectionTitle>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={flowData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border-2)" />
              <XAxis dataKey="date" tick={{ fill: "var(--muted-hi)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--muted-hi)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--elevated)", border: "1px solid var(--glass-border-2)" }} />
              <Area type="monotone" dataKey="backlog" stackId="1" stroke="#6B7280" fill="#6B7280" />
              <Area type="monotone" dataKey="in_progress" stackId="1" stroke="#00E5FF" fill="#00E5FF" />
              <Area type="monotone" dataKey="review" stackId="1" stroke="#F59E0B" fill="#F59E0B" />
              <Area type="monotone" dataKey="done" stackId="1" stroke="#10B981" fill="#10B981" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
