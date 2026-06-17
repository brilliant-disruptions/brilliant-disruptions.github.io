"use client";

import { useMilestones, useRevenue } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, MetricCard } from "@/components/ui";
import { money } from "@/lib/format";

const STATUS_TONE: Record<string, "green" | "cyan" | "amber" | "muted"> = {
  done: "green",
  active: "cyan",
  missed: "amber",
  open: "muted",
};

export default function ForecastPage() {
  const milestones = useMilestones();
  const revenue = useRevenue();
  const mrr = (revenue.data ?? []).reduce((s, r) => s + r.mrr_cents, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard label="Current MRR" value={money(mrr)} />
        <MetricCard label="Bull (6mo)" value={money(Math.round(mrr * 2.2))} sub="modeled" />
        <MetricCard label="Bear (6mo)" value={money(Math.round(mrr * 1.1))} sub="modeled" />
      </div>

      <section className="space-y-3">
        <SectionTitle>Strategic Milestones</SectionTitle>
        <div className="space-y-2">
          {milestones.data?.map((m) => (
            <Card key={m.id} className="flex items-center gap-3">
              <Badge tone={STATUS_TONE[m.status] ?? "muted"}>{m.status}</Badge>
              <div className="flex-1">
                <p className="text-sm text-[var(--white)]">{m.title}</p>
                {m.unlocks && (
                  <p className="font-mono text-[10px] text-[var(--cyan)]">unlocks: {m.unlocks}</p>
                )}
              </div>
              {m.target_date && (
                <span className="font-mono text-[10px] text-[var(--muted)]">{m.target_date}</span>
              )}
            </Card>
          ))}
        </div>
      </section>
      <p className="text-xs text-[var(--muted)]">
        Forecast scenarios are modeled from current MRR until Stripe/Mercury are
        connected (Phase 3).
      </p>
    </div>
  );
}
