"use client";

import { useMemo, useState } from "react";
import {
  useExpenses,
  useRevenue,
  useContributions,
  useConnections,
  useLatestMetrics,
  useMetricSeries,
} from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { MetricCard, SectionTitle, Card, Badge } from "@/components/ui";
import { money, timeAgo } from "@/lib/format";
import { monthlyBurnCents, runwayMonths, totalMrrCents } from "@/lib/metrics";
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

// Every institutional number on this page comes from a portfolio-level
// metric_snapshot written by an adapter. Listed once so the two queries below
// stay in sync with what the cards actually read.
const METRICS = [
  "cash",
  "stripe_balance",
  "stripe_mrr",
  "stripe_payouts_30d",
  "qb_revenue_mtd",
  "qb_expenses_mtd",
  "qb_net_income_mtd",
  "qb_ar_total",
  "qb_ar_overdue",
  "qb_ap_total",
];

// The providers that feed this page, in the order they matter.
const SYNC_PROVIDERS = ["plaid", "stripe", "quickbooks", "mercury"];

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "muted"> = {
  connected: "green",
  pending: "amber",
  error: "red",
  disconnected: "muted",
};

/** A metric card that tells the truth about missing data. "No bank connected"
 *  and "$0 in the bank" are different facts, and showing $0 for the first is how
 *  a dashboard quietly lies — so an absent metric renders as an em dash. */
function MoneyCard({
  label,
  cents,
  sub,
  missingHint,
}: {
  label: string;
  cents: number | null | undefined;
  sub?: string;
  missingHint: string;
}) {
  const has = typeof cents === "number";
  return <MetricCard label={label} value={has ? money(cents!) : "—"} sub={has ? sub : missingHint} />;
}

export function OverviewTab() {
  const expenses = useExpenses();
  const revenue = useRevenue();
  const contributions = useContributions();
  const connections = useConnections();
  const latest = useLatestMetrics(METRICS);
  const series = useMetricSeries(["cash", "stripe_balance", "qb_net_income_mtd"], 90);
  const activeBuild = useUIStore((s) => s.activeBuild);
  // Stable "now" for the trailing-30-day burn window — lazy init keeps render pure.
  const [asOfMs] = useState(() => Date.now());

  const m = latest.data;
  const get = (name: string): number | undefined => m?.get(name)?.value;

  // Burn is computed from the ledger (recurring templates + trailing-30-day
  // one-offs), not from QuickBooks: it must react the moment an expense is
  // logged, well before it appears in the books.
  const burn = monthlyBurnCents(expenses.data ?? [], asOfMs);

  // Cash that can actually pay a bill: what's in the bank plus what Stripe is
  // holding for us. Portfolio-only — a single build's burn against portfolio
  // cash would produce a meaningless runway.
  const bankCash = get("cash");
  const stripeBalance = get("stripe_balance");
  const spendableCash =
    activeBuild === "all" && (bankCash !== undefined || stripeBalance !== undefined)
      ? (bankCash ?? 0) + (stripeBalance ?? 0)
      : null;
  const runway = runwayMonths(spendableCash, burn);
  const runwayLabel =
    runway === null || runway === Infinity ? "∞" : `${runway.toFixed(1)} mo`;

  // Prefer Stripe's own view of active subscriptions; fall back to the sum of
  // recorded revenue entries when Stripe hasn't been pull-synced yet.
  const ledgerMrr = totalMrrCents(revenue.data ?? []);
  const stripeMrr = get("stripe_mrr");
  const mrr = stripeMrr ?? ledgerMrr;
  const netPerMonth = mrr - burn;

  const owedBack = (contributions.data ?? [])
    .filter((c) => c.repayable && !c.repaid_on)
    .reduce((s, c) => s + c.amount_cents, 0);

  // One row per day, columns per metric. Days a metric wasn't captured stay
  // undefined so recharts breaks the line instead of drawing a dive to zero.
  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const row of series.data ?? []) {
      const day = byDay.get(row.captured_on) ?? { day: row.captured_on.slice(5) };
      if (row.metric === "cash") day.Bank = row.value / 100;
      if (row.metric === "stripe_balance") day.Stripe = row.value / 100;
      if (row.metric === "qb_net_income_mtd") day["Net income"] = row.value / 100;
      byDay.set(row.captured_on, day);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [series.data]);

  const syncRows = (connections.data ?? [])
    .filter((c) => SYNC_PROVIDERS.includes(c.provider))
    .sort((a, b) => SYNC_PROVIDERS.indexOf(a.provider) - SYNC_PROVIDERS.indexOf(b.provider));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle>Cash & Runway</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyCard
            label="Cash in bank"
            cents={bankCash}
            sub={m?.get("cash") ? `as of ${m.get("cash")!.captured_on}` : undefined}
            missingHint="connect Relay / Plaid"
          />
          <MoneyCard
            label="Stripe balance"
            cents={stripeBalance}
            sub="available to pay out"
            missingHint="connect Stripe"
          />
          <MetricCard label="Monthly burn" value={money(burn)} sub="recurring + 30d" />
          <MetricCard
            label="Runway"
            value={runwayLabel}
            sub={
              spendableCash === null
                ? "no cash source connected"
                : burn <= 0
                  ? "no burn recorded"
                  : `on ${money(spendableCash)}`
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Revenue</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="MRR"
            value={money(mrr)}
            sub={stripeMrr !== undefined ? "live from Stripe" : "from recorded revenue"}
          />
          <MoneyCard label="Revenue MTD" cents={get("qb_revenue_mtd")} sub="QuickBooks" missingHint="connect QuickBooks" />
          <MoneyCard
            label="Expenses MTD"
            cents={get("qb_expenses_mtd")}
            sub="QuickBooks"
            missingHint="connect QuickBooks"
          />
          <MetricCard
            label="Net / mo"
            value={money(netPerMonth)}
            sub={netPerMonth >= 0 ? "positive" : "burning"}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Receivables & Obligations</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyCard label="A/R outstanding" cents={get("qb_ar_total")} sub="owed to us" missingHint="connect QuickBooks" />
          <MoneyCard
            label="A/R overdue"
            cents={get("qb_ar_overdue")}
            sub="past due — chase these"
            missingHint="connect QuickBooks"
          />
          <MoneyCard label="A/P outstanding" cents={get("qb_ap_total")} sub="we owe" missingHint="connect QuickBooks" />
          <MetricCard
            label="Owner capital owed"
            value={money(owedBack)}
            sub={owedBack > 0 ? "repayable contributions" : "nothing outstanding"}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>90-Day Trend</SectionTitle>
        <Card className="h-72">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-[var(--muted-hi)]">
              No history yet. Each sync writes one point per day — connect a source and this fills in.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="day" stroke="var(--muted)" fontSize={11} />
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
                <Line type="monotone" dataKey="Bank" stroke="var(--cyan)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="Stripe" stroke="var(--success)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="Net income" stroke="var(--warn)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>Data Freshness</SectionTitle>
        {/* A stale number has to look stale. Without this strip a dashboard that
            stopped syncing three weeks ago is indistinguishable from a healthy one. */}
        <Card className="divide-y divide-[var(--glass-border)] p-0">
          {syncRows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <Badge tone={STATUS_TONE[c.status] ?? "muted"}>{c.status}</Badge>
              <span className="flex-1 truncate text-sm text-[var(--white)]">{c.display_name}</span>
              {c.last_sync_status === "error" && <Badge tone="red">last sync failed</Badge>}
              <span className="font-mono text-[10px] text-[var(--muted)]">
                {c.last_sync_at ? `synced ${timeAgo(c.last_sync_at)}` : "never synced"}
              </span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
