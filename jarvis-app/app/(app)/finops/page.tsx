"use client";

import { useState } from "react";
import { useExpenses, useRevenue, useBuilds } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { MetricCard, SectionTitle, Card, EmptyState, Badge } from "@/components/ui";
import { NewExpenseModal } from "@/components/NewExpenseModal";
import { primaryBtn } from "@/components/Modal";
import { money } from "@/lib/format";

export default function FinOpsPage() {
  const expenses = useExpenses();
  const revenue = useRevenue();
  const builds = useBuilds();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [open, setOpen] = useState(false);

  const mrr = (revenue.data ?? []).reduce((s, r) => s + r.mrr_cents, 0);
  const recurring = (expenses.data ?? []).filter((e) => e.is_recurring).reduce((s, e) => s + e.amount_cents, 0);
  const totalSpend = (expenses.data ?? []).reduce((s, e) => s + e.amount_cents, 0);
  const margin = mrr - recurring;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="MRR" value={money(mrr)} />
        <MetricCard label="Monthly Burn" value={money(recurring)} sub="recurring" />
        <MetricCard label="Net / mo" value={money(margin)} sub={margin >= 0 ? "positive" : "burning"} />
        <MetricCard label="Runway" value={recurring > 0 ? "modeled" : "∞"} sub="bootstrapped" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Expenses · {money(totalSpend)} total</SectionTitle>
          {(builds.data?.length ?? 0) > 0 && (
            <button className={primaryBtn} onClick={() => setOpen(true)}>
              + Log expense
            </button>
          )}
        </div>
        {(expenses.data?.length ?? 0) === 0 ? (
          <EmptyState title="No expenses logged" hint="Log one to see burn and margin update live." />
        ) : (
          <Card className="divide-y divide-[var(--glass-border)] p-0">
            {expenses.data?.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge tone="muted">{e.category}</Badge>
                <span className="flex-1 text-sm text-[var(--white)]">{e.vendor}</span>
                {e.is_recurring && <Badge tone="cyan">recurring</Badge>}
                <span className="font-mono text-sm text-[var(--white)] tabular-nums">
                  {money(e.amount_cents)}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">{e.spent_on}</span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <NewExpenseModal
        open={open}
        onClose={() => setOpen(false)}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />
    </div>
  );
}
