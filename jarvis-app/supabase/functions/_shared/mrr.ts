// Stripe price → normalized monthly recurring revenue. Deliberately
// dependency-free (no jsr:/npm: imports) so the same file runs in Deno inside
// the edge function AND under vitest in lib/mrr.test.ts — this math decides the
// headline MRR number on the FinOps dashboard and must not go untested.
//
// Cents in, cents out.

export type StripePrice = {
  unit_amount?: number | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
};
export type StripeItem = { price?: StripePrice | null; quantity?: number | null };
export type StripeSubscription = { items?: { data?: StripeItem[] } | null };

// Days per interval, used to project non-monthly billing onto a month. Weekly
// uses 365/7/12 = 4.345 rather than 4, so a weekly plan isn't understated by 8%.
const PER_MONTH: Record<string, number> = {
  day: 365 / 12,
  week: 365 / 7 / 12,
  month: 1,
  year: 1 / 12,
};

/** Monthly-equivalent value of one subscription line. A $1,200/yr plan is $100
 *  of MRR, not $1,200 — the same amortization burn already applies to annual
 *  expenses, so revenue and cost stay comparable on the dashboard.
 *  A price with no `recurring` block is one-time and contributes 0. */
export function itemMonthlyCents(item: StripeItem): number {
  const price = item.price;
  const interval = price?.recurring?.interval;
  if (!price || !interval) return 0;
  const per = PER_MONTH[interval];
  if (!per) return 0;
  const count = Math.max(1, Number(price.recurring?.interval_count ?? 1));
  const unit = Number(price.unit_amount ?? 0);
  const qty = Math.max(0, Number(item.quantity ?? 1));
  return Math.round((unit * qty * per) / count);
}

/** Total normalized MRR across active subscriptions. */
export function subscriptionsMrrCents(subs: StripeSubscription[]): number {
  return subs.reduce(
    (total, s) => total + (s.items?.data ?? []).reduce((t, i) => t + itemMonthlyCents(i), 0),
    0,
  );
}
