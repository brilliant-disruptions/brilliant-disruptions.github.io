import { describe, it, expect } from "vitest";
import {
  monthlyBurnCents,
  runwayMonths,
  totalMrrCents,
  avgDealMrrCents,
  pipelineExpectedMrrCents,
  forecastMrrCents,
  STAGE_CLOSE_PROB,
} from "./metrics";

// Tests encode WHY: these numbers drive cash decisions, so the math must be
// deterministic and the invariants must hold regardless of data shape.

const ASOF = new Date("2026-06-18").getTime();

describe("monthlyBurnCents — recurring + recent one-off, so burn reflects this month", () => {
  it("counts all recurring expenses and only last-30-day one-offs", () => {
    const burn = monthlyBurnCents(
      [
        { amount_cents: 10000, is_recurring: true, spent_on: "2025-01-01" }, // old but recurring → counts
        { amount_cents: 5000, is_recurring: false, spent_on: "2026-06-10" }, // recent one-off → counts
        { amount_cents: 9999, is_recurring: false, spent_on: "2026-01-01" }, // stale one-off → excluded
      ],
      ASOF,
    );
    expect(burn).toBe(15000);
  });

  it("ignores future-dated one-offs (clock skew shouldn't inflate burn)", () => {
    const burn = monthlyBurnCents([{ amount_cents: 5000, is_recurring: false, spent_on: "2026-12-01" }], ASOF);
    expect(burn).toBe(0);
  });

  it("amortizes annual recurring to its monthly cost (÷12), so one yearly bill doesn't read as 12× the burn", () => {
    // A $1,200/yr tool is $100/mo of burn; a $300/mo tool is $300/mo. Treating
    // the annual line as $1,200/mo would overstate monthly runway pressure 12×.
    const burn = monthlyBurnCents(
      [
        { amount_cents: 120000, is_recurring: true, recurrence: "annual", spent_on: "2026-01-01" },
        { amount_cents: 30000, is_recurring: true, recurrence: "monthly", spent_on: "2026-06-01" },
      ],
      ASOF,
    );
    expect(burn).toBe(10000 + 30000);
  });

  it("treats unset recurrence as monthly (historical default — no silent reduction)", () => {
    const burn = monthlyBurnCents([{ amount_cents: 5000, is_recurring: true, spent_on: "2025-01-01" }], ASOF);
    expect(burn).toBe(5000);
  });
});

describe("runwayMonths — bootstrapped vs real cash, so the UI tells the truth", () => {
  it("returns null when cash is unknown (no bank connected → ∞/bootstrapped)", () => {
    expect(runwayMonths(null, 10000)).toBeNull();
  });
  it("returns Infinity when not burning, else cash/burn", () => {
    expect(runwayMonths(50000, 0)).toBe(Infinity);
    expect(runwayMonths(60000, 10000)).toBe(6);
  });
});

describe("MRR + deal sizing", () => {
  it("totalMrrCents sums contributions", () => {
    expect(totalMrrCents([{ mrr_cents: 1000 }, { mrr_cents: 2500 }])).toBe(3500);
  });
  it("avgDealMrrCents uses realized revenue, else the fallback, else 0", () => {
    expect(avgDealMrrCents([{ mrr_cents: 2000 }, { mrr_cents: 4000 }])).toBe(3000);
    expect(avgDealMrrCents([{ mrr_cents: 0 }], 5000)).toBe(5000); // nothing paid → fallback
    expect(avgDealMrrCents([], 0)).toBe(0); // no signal → flat forecast, honestly
  });
});

describe("pipelineExpectedMrrCents — probability-weighted so forecasts aren't wishful", () => {
  it("weights each prospect by its stage close probability × deal size", () => {
    const expected = pipelineExpectedMrrCents(
      [{ status: "qualified" }, { status: "sent" }, { status: "new" }],
      10000,
    );
    // 0.4 + 0.03 + 0 = 0.43 × 10000
    expect(expected).toBe(Math.round((STAGE_CLOSE_PROB.qualified + STAGE_CLOSE_PROB.sent) * 10000));
  });
  it("a won/lost-only pipeline contributes nothing new", () => {
    expect(pipelineExpectedMrrCents([{ status: "won" }, { status: "lost" }], 10000)).toBe(0);
  });
});

describe("forecastMrrCents — bull ≥ base ≥ bear, monotonic, base captures the weighted pipeline", () => {
  const f = forecastMrrCents(10000, 6000);

  it("produces a 6-month series per scenario", () => {
    expect(f.base).toHaveLength(6);
  });
  it("base month-6 = current + full weighted pipeline (the expectation)", () => {
    expect(f.base[5]).toBe(16000);
  });
  it("orders scenarios bull ≥ base ≥ bear at every month", () => {
    for (let i = 0; i < 6; i++) {
      expect(f.bull[i]).toBeGreaterThanOrEqual(f.base[i]);
      expect(f.base[i]).toBeGreaterThanOrEqual(f.bear[i]);
    }
  });
  it("each series is non-decreasing (pipeline ramps in, never out)", () => {
    for (let i = 1; i < 6; i++) expect(f.base[i]).toBeGreaterThanOrEqual(f.base[i - 1]);
  });
  it("a zero pipeline yields a flat forecast at current MRR", () => {
    const flat = forecastMrrCents(8000, 0);
    expect(new Set(flat.base)).toEqual(new Set([8000]));
  });
});
