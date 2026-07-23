-- 0021_contributions.sql
-- Personal / owner contributions into the business (FinOps §5.x).
-- Founders routinely fund the studio out of pocket — cash injected, gear bought
-- personally, or a bill paid on a personal card. Accounting-wise these are NOT
-- revenue: they are either owner's equity (capital contributed, non-repayable)
-- or a loan / reimbursable outlay the company owes back. Tracking them keeps the
-- books honest about who has put in what, and how much the company still owes.
--
-- `kind` records the accounting treatment:
--   cash      — cash paid into the company bank/equity (capital contribution)
--   in_kind   — non-cash asset contributed (hardware, domains, etc.), at value
--   expense   — a business expense paid personally (reimbursable outlay)
--   loan      — money lent to the company, expected to be repaid
-- `repayable`  is true for expense/loan (a liability), false for cash/in_kind
--   (equity). `repaid_on` is set once the company has paid the member back.
-- Mirrors expenses: member read + write all, live via realtime, updated_at trigger.

create table public.contributions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete restrict,  -- who contributed
  build_id    uuid references public.builds(id) on delete set null,            -- null = studio/overhead
  kind        text not null check (kind in ('cash', 'in_kind', 'expense', 'loan')),
  amount_cents int not null check (amount_cents > 0),
  currency    text not null default 'usd',
  contributed_on date not null default current_date,
  repayable   boolean not null default false,   -- true = company owes it back (liability)
  repaid_on   date,                             -- set when reimbursed/repaid; null = outstanding
  description text not null,                    -- what it was for
  notes       text,
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index contributions_member_idx on public.contributions (member_id, contributed_on desc);
create index contributions_build_idx on public.contributions (build_id, contributed_on desc);

alter table public.contributions enable row level security;

-- Same v1 access as other domain tables: any active member reads and writes.
create policy contributions_select on public.contributions
  for select to authenticated using (public.is_member());
create policy contributions_write on public.contributions
  for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- Live updates on the FinOps ledger.
alter publication supabase_realtime add table public.contributions;

-- Keep updated_at fresh, like every other mutable table.
create trigger trg_contributions_updated_at before update on public.contributions
  for each row execute function public.set_updated_at();
