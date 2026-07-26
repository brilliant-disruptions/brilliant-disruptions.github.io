-- 0022_expense_description_recurrence.sql
-- Two FinOps ledger gaps (§5.3):
--
-- 1. `description` — expenses only carried vendor + category, so "why did we
--    pay Vercel $240?" was unanswerable from the row. Contributions already
--    have a required description; expenses get an optional one (existing rows
--    and machine-synced expenses have nothing sensible to backfill).
--
-- 2. `effective_on` — a recurring expense is a *subscription*, not a single
--    charge, but the row only had `spent_on`. Without a start date the ledger
--    can't show the charge repeating each month/year. `effective_on` is the
--    date the recurrence began; the UI expands it forward (monthly or annual,
--    per `recurrence`) up to today. Null = fall back to `spent_on`, so every
--    existing recurring row keeps working with no backfill.

alter table public.expenses
  add column description  text,
  add column effective_on date;

comment on column public.expenses.description is
  'Free-text note on what the spend was for. Optional.';
comment on column public.expenses.effective_on is
  'First charge date of a recurring expense; recurrence is expanded forward from here. Null = use spent_on.';
