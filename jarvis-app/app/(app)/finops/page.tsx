"use client";

import { useState } from "react";
import { OverviewTab } from "./OverviewTab";
import { ExpensesTab } from "./ExpensesTab";
import { ContributionsTab } from "./ContributionsTab";

const TABS = ["Overview", "Expenses", "Contributions"] as const;
type Tab = (typeof TABS)[number];

/** FinOps is the one screen for "how is the company actually doing?" — Overview
 *  answers it from the connected sources (bank via Plaid, Stripe, QuickBooks);
 *  the other two tabs are the hand-kept ledgers that feed burn and owner capital. */
export default function FinOpsPage() {
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[var(--glass-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-wide transition ${
              tab === t
                ? "border-[var(--cyan)] text-[var(--white)]"
                : "border-transparent text-[var(--muted-hi)] hover:text-[var(--white)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Expenses" && <ExpensesTab />}
      {tab === "Contributions" && <ContributionsTab />}
    </div>
  );
}
