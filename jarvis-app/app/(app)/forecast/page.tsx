"use client";

import { useMilestones, useRevenue, useProspects, useBuilds } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, MetricCard } from "@/components/ui";
import { money } from "@/lib/format";
import {
  totalMrrCents,
  avgDealMrrCents,
  pipelineExpectedMrrCents,
  forecastMrrCents,
} from "@/lib/metrics";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

const STATUS_TONE: Record<string, "green" | "cyan" | "amber" | "muted"> = {
  done: "green",
  active: "cyan",
  missed: "amber",
  open: "muted",
};

export default function ForecastPage() {
  const milestones = useMilestones();
  const revenue = useRevenue();
  const prospects = useProspects();
  const builds = useBuilds();

  const mrr = totalMrrCents(revenue.data ?? []);
  // Deal size: realized revenue if any, else mean of non-zero build MRR targets,
  // else 0 (→ a flat, honest forecast rather than an invented hockey stick).
  const targets = (builds.data ?? []).map((b) => b.mrr_target_cents).filter((t) => t > 0);
  const fallback = targets.length ? targets.reduce((s, t) => s + t, 0) / targets.length : 0;
  const dealMrr = avgDealMrrCents(revenue.data ?? [], fallback);
  const pipeline = pipelineExpectedMrrCents(prospects.data ?? [], dealMrr);
  const f = forecastMrrCents(mrr, pipeline);

  const chartData = f.base.map((_, i) => ({
    month: `M${i + 1}`,
    Bull: f.bull[i] / 100,
    Base: f.base[i] / 100,
    Bear: f.bear[i] / 100,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Current MRR" value={money(mrr)} />
        <MetricCard label="Bull (6mo)" value={money(f.bull[5])} sub="pipeline-weighted" />
        <MetricCard label="Base (6mo)" value={money(f.base[5])} sub="pipeline-weighted" />
        <MetricCard label="Bear (6mo)" value={money(f.bear[5])} sub="pipeline-weighted" />
      </div>

      <section className="space-y-3">
        <SectionTitle>6-Month MRR Trajectory</SectionTitle>
        <Card className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
              <XAxis dataKey="month" stroke="var(--muted)" fontSize={11} />
              <YAxis stroke="var(--muted)" fontSize={11} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{
                  background: "var(--elevated)",
                  border: "1px solid var(--glass-border-2)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => `$${Number(v).toLocaleString()}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Bull" stroke="var(--success)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Base" stroke="var(--cyan)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Bear" stroke="var(--warn)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <p className="text-xs text-[var(--muted)]">
          Scenarios project current MRR plus probability-weighted pipeline (prospects ×
          stage close-rates) over six months. Connect Stripe/Mercury to replace modeled
          deal size with realized revenue and cash.
        </p>
      </section>

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
    </div>
  );
}
