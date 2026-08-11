"use client";

import { useMemo, useState } from "react";
import { useExpenses, useBuilds } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { SectionTitle, Card, EmptyState, Badge } from "@/components/ui";
import { NewExpenseModal } from "@/components/NewExpenseModal";
import { EditExpenseModal } from "@/components/EditExpenseModal";
import type { Tables } from "@/lib/database.types";
import { primaryBtn } from "@/components/Modal";
import { money } from "@/lib/format";
import { expandExpenses } from "@/lib/metrics";

/** The manual + auto-drafted expense ledger. Rows drafted by the bank sync carry
 *  source=plaid|mercury and land here for categorization like any other row. */
export function ExpensesTab() {
  const expenses = useExpenses();
  const builds = useBuilds();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [open, setOpen] = useState(false);
  // Row being edited, or null. Editing a recurring expense edits the underlying
  // template — clicking any of its derived charges opens the same row.
  const [editExpense, setEditExpense] = useState<Tables<"expenses"> | null>(null);
  // Stable "now" so the expansion doesn't drift mid-session; lazy init keeps render pure.
  const [asOfMs] = useState(() => Date.now());

  // Ledger view: recurring rows expanded into every charge since their
  // effective date, so total spend is what has actually left the account.
  const charges = useMemo(
    () => expandExpenses(expenses.data ?? [], new Date(asOfMs).toISOString().slice(0, 10)),
    [expenses.data, asOfMs],
  );
  const totalSpend = charges.reduce((s, c) => s + c.expense.amount_cents, 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle>Expenses · {money(totalSpend)} total</SectionTitle>
        {(builds.data?.length ?? 0) > 0 && (
          <button className={primaryBtn} onClick={() => setOpen(true)}>
            + Log expense
          </button>
        )}
      </div>
      {charges.length === 0 ? (
        <EmptyState title="No expenses logged" hint="Log one to see burn and margin update live." />
      ) : (
        <Card className="divide-y divide-[var(--glass-border)] p-0">
          {charges.map(({ expense: e, on, occurrence }) => (
            <button
              key={`${e.id}:${occurrence}`}
              onClick={() => setEditExpense(e)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
              title="Edit expense"
            >
              <Badge tone="muted">{e.category}</Badge>
              <span className="block min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--white)]">{e.vendor}</span>
                {e.description && (
                  <span className="block truncate text-[10px] text-[var(--muted)]">{e.description}</span>
                )}
              </span>
              {/* Bank-drafted rows are unreviewed until a human categorizes them. */}
              {e.source !== "manual" && e.category === "other" && <Badge tone="amber">review</Badge>}
              {e.is_recurring && <Badge tone="cyan">{e.recurrence === "annual" ? "annual" : "monthly"}</Badge>}
              <span className="font-mono text-sm text-[var(--white)] tabular-nums">
                {money(e.amount_cents)}
              </span>
              <span className="font-mono text-[10px] text-[var(--muted)]">{on}</span>
            </button>
          ))}
        </Card>
      )}

      <NewExpenseModal
        open={open}
        onClose={() => setOpen(false)}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />

      {/* Keyed so each selection mounts a form seeded from that record. */}
      {editExpense && (
        <EditExpenseModal
          key={editExpense.id}
          expense={editExpense}
          builds={builds.data ?? []}
          onClose={() => setEditExpense(null)}
        />
      )}
    </section>
  );
}
