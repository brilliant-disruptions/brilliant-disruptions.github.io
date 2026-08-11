import { describe, it, expect } from "vitest";
import { itemMonthlyCents, subscriptionsMrrCents } from "../supabase/functions/_shared/mrr";

// This math produces the headline MRR on the FinOps dashboard. It lives in the
// edge-function shared dir (Deno) but is dependency-free precisely so it can be
// tested here — an un-normalized annual plan would overstate MRR 12×, which is
// exactly the kind of error that makes a founder misjudge runway.

describe("itemMonthlyCents — annual/weekly plans must be stated as a monthly rate", () => {
  it("passes a monthly plan through unchanged", () => {
    expect(itemMonthlyCents({ price: { unit_amount: 4900, recurring: { interval: "month" } }, quantity: 1 })).toBe(4900);
  });

  it("amortizes an annual plan to 1/12 — $1,200/yr is $100 of MRR, not $1,200", () => {
    expect(itemMonthlyCents({ price: { unit_amount: 120000, recurring: { interval: "year" } }, quantity: 1 })).toBe(10000);
  });

  it("divides by interval_count: billed every 3 months is a third of the monthly rate", () => {
    expect(
      itemMonthlyCents({ price: { unit_amount: 30000, recurring: { interval: "month", interval_count: 3 } }, quantity: 1 }),
    ).toBe(10000);
  });

  it("scales weekly by 4.345, not 4 — rounding to 4 understates weekly revenue ~8%", () => {
    // $100/wk → 100 * 365/7/12 = $434.52
    expect(itemMonthlyCents({ price: { unit_amount: 10000, recurring: { interval: "week" } }, quantity: 1 })).toBe(43452);
  });

  it("multiplies by seat quantity", () => {
    expect(itemMonthlyCents({ price: { unit_amount: 1000, recurring: { interval: "month" } }, quantity: 7 })).toBe(7000);
  });

  it("contributes nothing for a one-time price — MRR must only count recurring revenue", () => {
    expect(itemMonthlyCents({ price: { unit_amount: 500000 }, quantity: 1 })).toBe(0);
    expect(itemMonthlyCents({ price: { unit_amount: 500000, recurring: null }, quantity: 1 })).toBe(0);
  });

  it("treats a missing quantity as 1 and a missing amount as 0 rather than NaN", () => {
    expect(itemMonthlyCents({ price: { unit_amount: 2500, recurring: { interval: "month" } } })).toBe(2500);
    expect(itemMonthlyCents({ price: { recurring: { interval: "month" } }, quantity: 3 })).toBe(0);
  });
});

describe("subscriptionsMrrCents — portfolio total across mixed plans", () => {
  it("sums every line of every subscription", () => {
    const total = subscriptionsMrrCents([
      { items: { data: [{ price: { unit_amount: 4900, recurring: { interval: "month" } }, quantity: 2 }] } },
      { items: { data: [{ price: { unit_amount: 120000, recurring: { interval: "year" } }, quantity: 1 }] } },
    ]);
    expect(total).toBe(9800 + 10000);
  });

  it("is 0 for no subscriptions — a pre-revenue studio reads zero, never NaN", () => {
    expect(subscriptionsMrrCents([])).toBe(0);
    expect(subscriptionsMrrCents([{}, { items: null }])).toBe(0);
  });
});
