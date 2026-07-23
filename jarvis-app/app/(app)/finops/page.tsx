"use client";

import { useMemo, useState } from "react";
import {
  useExpenses,
  useRevenue,
  useBuilds,
  useCashOnHand,
  useContributions,
  useMembers,
} from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { MetricCard, SectionTitle, Card, EmptyState, Badge } from "@/components/ui";
import { NewExpenseModal } from "@/components/NewExpenseModal";
import { NewContributionModal } from "@/components/NewContributionModal";
import { primaryBtn } from "@/components/Modal";
import { money } from "@/lib/format";
import { monthlyBurnCents, runwayMonths, totalMrrCents } from "@/lib/metrics";

export default function FinOpsPage() {
  const expenses = useExpenses();
  const revenue = useRevenue();
  const builds = useBuilds();
  const contributions = useContributions();
  const members = useMembers();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [open, setOpen] = useState(false);
  const [contribOpen, setContribOpen] = useState(false);
  // Stable "now" for the trailing-30-day window — lazy init keeps render pure.
  const [asOfMs] = useState(() => Date.now());

  const mrr = totalMrrCents(revenue.data ?? []);
  // Real burn: recurring + trailing-30-day one-offs (§8.2). Cash is unknown
  // until a bank is connected (Phase 3) → runway is bootstrapped/∞, not faked.
  const burn = monthlyBurnCents(expenses.data ?? [], asOfMs);
  // Cash is studio-level (from the bank sync). Pair it with burn only in the
  // portfolio view; a single build's burn vs. portfolio cash would mislead.
  const cash = useCashOnHand();
  const cashCents = activeBuild === "all" ? (cash.data ?? null) : null;
  const runway = runwayMonths(cashCents, burn);
  const totalSpend = (expenses.data ?? []).reduce((s, e) => s + e.amount_cents, 0);
  const margin = mrr - burn;
  const runwayLabel = runway === null ? "∞" : runway === Infinity ? "∞" : `${runway.toFixed(1)} mo`;

  const contribs = contributions.data ?? [];
  // Total capital put in by owners, and how much the company still owes back
  // (repayable contributions not yet marked repaid).
  const totalContributed = contribs.reduce((s, c) => s + c.amount_cents, 0);
  const owedBack = contribs
    .filter((c) => c.repayable && !c.repaid_on)
    .reduce((s, c) => s + c.amount_cents, 0);
  const memberName = useMemo(() => {
    const map = new Map((members.data ?? []).map((m) => [m.id, m.full_name]));
    return (id: string) => map.get(id) ?? "—";
  }, [members.data]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="MRR" value={money(mrr)} />
        <MetricCard label="Monthly Burn" value={money(burn)} sub="recurring + 30d" />
        <MetricCard label="Net / mo" value={money(margin)} sub={margin >= 0 ? "positive" : "burning"} />
        <MetricCard label="Runway" value={runwayLabel} sub={cashCents === null ? "bootstrapped" : "from cash"} />
        <MetricCard
          label="Contributed"
          value={money(totalContributed)}
          sub={owedBack > 0 ? `${money(owedBack)} owed back` : "owner capital"}
        />
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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>
            Contributions · {money(totalContributed)} in
            {owedBack > 0 ? ` · ${money(owedBack)} owed` : ""}
          </SectionTitle>
          {(members.data?.length ?? 0) > 0 && (
            <button className={primaryBtn} onClick={() => setContribOpen(true)}>
              + Log contribution
            </button>
          )}
        </div>
        {contribs.length === 0 ? (
          <EmptyState
            title="No contributions logged"
            hint="Track cash, gear, or expenses you've personally put into the business."
          />
        ) : (
          <Card className="divide-y divide-[var(--glass-border)] p-0">
            {contribs.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge tone="muted">{c.kind}</Badge>
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-sm text-[var(--white)]">{c.description}</span>
                  <span className="text-[10px] text-[var(--muted)]">{memberName(c.member_id)}</span>
                </div>
                {c.repayable &&
                  (c.repaid_on ? (
                    <Badge tone="green">repaid</Badge>
                  ) : (
                    <Badge tone="amber">owed</Badge>
                  ))}
                <span className="font-mono text-sm text-[var(--white)] tabular-nums">
                  {money(c.amount_cents)}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">{c.contributed_on}</span>
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

      <NewContributionModal
        open={contribOpen}
        onClose={() => setContribOpen(false)}
        members={members.data ?? []}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />
    </div>
  );
}
