// Pure financial + forecast math (spec §8.2–8.4). Kept dependency-free and
// deterministic so it is unit-testable and so the UI never invents numbers —
// the AI layer can *explain* these, but the figures come from here.
//
// Cents in, cents out. Dates are ISO 'YYYY-MM-DD' strings (expenses.spent_on).

export type ExpenseLite = {
  amount_cents: number;
  is_recurring: boolean;
  spent_on: string;
  recurrence?: string | null;
};
export type RevenueLite = { mrr_cents: number };
export type ProspectLite = { status: string };

/** Stage → probability the prospect closes (§8.4 consulting defaults). Stages
 *  not listed (new, won, lost) contribute 0 expected pipeline. Configurable in
 *  future via connections.config; defaults live here so the math is testable. */
export const STAGE_CLOSE_PROB: Record<string, number> = {
  sent: 0.03,
  engaged: 0.1,
  replied: 0.2,
  qualified: 0.4,
  call_booked: 0.6,
};

const DAY_MS = 86_400_000;

/** Monthly burn (§8.2): recurring expenses + trailing-30-day non-recurring
 *  spend (a one-month average proxy). `asOf` is an ISO date; defaults caller-
 *  supplied to keep this pure (no Date.now() baked in).
 *
 *  Annual recurring is amortized to its monthly equivalent (÷12): a $1,200/yr
 *  tool costs $100/mo of burn, not $1,200 — otherwise a single annual line item
 *  would overstate monthly runway pressure by 12×. Unset recurrence is treated
 *  as monthly (the historical default). */
export function monthlyBurnCents(expenses: ExpenseLite[], asOfMs: number): number {
  let recurring = 0;
  let recentOneOff = 0;
  for (const e of expenses) {
    if (e.is_recurring) {
      recurring += e.recurrence === "annual" ? Math.round(e.amount_cents / 12) : e.amount_cents;
    } else {
      const spentMs = new Date(e.spent_on).getTime();
      if (Number.isFinite(spentMs) && asOfMs - spentMs <= 30 * DAY_MS && spentMs <= asOfMs) {
        recentOneOff += e.amount_cents;
      }
    }
  }
  return recurring + recentOneOff;
}

/** One charge of an expense as it lands on the ledger: either the row itself
 *  (`occurrence === 0`) or a generated repeat of a recurring row. Generated
 *  occurrences are display-only — they are NOT rows in the DB, so they carry the
 *  template's id plus the occurrence index to key on. */
export type ExpenseOccurrence<T> = { expense: T; on: string; occurrence: number };

/** Advance an ISO date by n months, clamping to the end of the target month so
 *  a Jan-31 subscription bills Feb-28 rather than skipping into March. */
function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Expand recurring expenses into every charge that has actually happened, from
 *  their `effective_on` start date (falling back to `spent_on`) up to and
 *  including `asOfIso`. A recurring row is a subscription: the ledger must show
 *  the twelve monthly charges a year-old $20/mo tool has really cost, not one.
 *
 *  Non-recurring expenses pass through as a single occurrence. Results are
 *  sorted newest-first to match the ledger's `spent_on desc` ordering.
 *
 *  Do NOT feed the result to monthlyBurnCents — burn is computed from the
 *  templates (recurring counted once per month by definition); expanded charges
 *  would multiply it by however long the subscription has run. */
export function expandExpenses<
  T extends { amount_cents: number; is_recurring: boolean; spent_on: string; recurrence?: string | null; effective_on?: string | null },
>(expenses: T[], asOfIso: string): ExpenseOccurrence<T>[] {
  const out: ExpenseOccurrence<T>[] = [];
  for (const e of expenses) {
    const start = e.effective_on || e.spent_on;
    // Unset recurrence means monthly (the historical default, as in burn).
    const step = e.recurrence === "annual" ? 12 : 1;
    if (!e.is_recurring || !start || start > asOfIso) {
      out.push({ expense: e, on: e.spent_on, occurrence: 0 });
      continue;
    }
    let on = start;
    for (let i = 0; on <= asOfIso; i++) {
      out.push({ expense: e, on, occurrence: i });
      on = addMonthsIso(start, step * (i + 1));
    }
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

/** Runway in months (§8.2). `cashCents = null` → bootstrapped (∞ / unknown,
 *  shown until a bank is connected). Zero/negative burn → Infinity. */
export function runwayMonths(cashCents: number | null, burnCents: number): number | null {
  if (cashCents === null) return null;
  if (burnCents <= 0) return Infinity;
  return cashCents / burnCents;
}

/** Portfolio (or per-build, when pre-filtered) MRR = Σ active mrr contributions. */
export function totalMrrCents(revenue: RevenueLite[]): number {
  return revenue.reduce((s, r) => s + (r.mrr_cents ?? 0), 0);
}

/** Average MRR contribution of realized revenue — the deal size used to value
 *  the pipeline. Falls back to `fallbackCents` (e.g. mean build MRR target) when
 *  nothing has closed yet, and 0 if there is no signal at all (→ flat forecast,
 *  which is the honest pre-revenue state). */
export function avgDealMrrCents(revenue: RevenueLite[], fallbackCents = 0): number {
  const paid = revenue.filter((r) => (r.mrr_cents ?? 0) > 0);
  if (paid.length === 0) return Math.max(0, Math.round(fallbackCents));
  return Math.round(paid.reduce((s, r) => s + r.mrr_cents, 0) / paid.length);
}

/** Expected NEW MRR from the current pipeline over the horizon (§8.4):
 *  Σ prospects[ P(close by stage) ] × average deal MRR. Probability-weighted,
 *  so the base scenario captures exactly this. */
export function pipelineExpectedMrrCents(prospects: ProspectLite[], dealMrrCents: number): number {
  const weight = prospects.reduce((s, p) => s + (STAGE_CLOSE_PROB[p.status] ?? 0), 0);
  return Math.round(weight * dealMrrCents);
}

export type Scenario = "bull" | "base" | "bear";
/** Scenario multipliers applied to the (already probability-weighted) pipeline
 *  contribution. Base = 1.0 captures the weighted expectation; bull/bear bracket
 *  execution + market risk around it. */
export const SCENARIO_FACTOR: Record<Scenario, number> = { bull: 1.6, base: 1.0, bear: 0.4 };

/** 6-month end-of-month MRR projection per scenario (§8.4). New pipeline MRR
 *  ramps linearly across the horizon on top of current MRR. Returns cents.
 *  Invariant: bull ≥ base ≥ bear at every month; each series is non-decreasing. */
export function forecastMrrCents(
  currentMrrCents: number,
  pipelineExpected: number,
  horizonMonths = 6,
): Record<Scenario, number[]> {
  const build = (factor: number): number[] =>
    Array.from({ length: horizonMonths }, (_, i) =>
      Math.round(currentMrrCents + pipelineExpected * factor * ((i + 1) / horizonMonths)),
    );
  return {
    bull: build(SCENARIO_FACTOR.bull),
    base: build(SCENARIO_FACTOR.base),
    bear: build(SCENARIO_FACTOR.bear),
  };
}
