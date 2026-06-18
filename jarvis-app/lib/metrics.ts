// Pure financial + forecast math (spec §8.2–8.4). Kept dependency-free and
// deterministic so it is unit-testable and so the UI never invents numbers —
// the AI layer can *explain* these, but the figures come from here.
//
// Cents in, cents out. Dates are ISO 'YYYY-MM-DD' strings (expenses.spent_on).

export type ExpenseLite = { amount_cents: number; is_recurring: boolean; spent_on: string };
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
 *  supplied to keep this pure (no Date.now() baked in). */
export function monthlyBurnCents(expenses: ExpenseLite[], asOfMs: number): number {
  let recurring = 0;
  let recentOneOff = 0;
  for (const e of expenses) {
    if (e.is_recurring) {
      recurring += e.amount_cents;
    } else {
      const spentMs = new Date(e.spent_on).getTime();
      if (Number.isFinite(spentMs) && asOfMs - spentMs <= 30 * DAY_MS && spentMs <= asOfMs) {
        recentOneOff += e.amount_cents;
      }
    }
  }
  return recurring + recentOneOff;
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
