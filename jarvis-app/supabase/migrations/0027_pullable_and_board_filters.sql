-- 0027_pullable_and_board_filters.sql
-- Tickets gain a "pullable" flag (independent of stage — a ticket in
-- in_progress/review can still be flagged as available to grab, and the
-- board's Backlog column splits into plain/pullable using this same flag)
-- plus a shared library of saved board filter presets.

alter table tickets add column pullable boolean not null default false;

create table board_filters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  config jsonb not null default '{}',
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table board_filters enable row level security;
create policy member_select on board_filters for select to authenticated using (public.is_member());
create policy member_write on board_filters for all to authenticated
  using (public.is_member()) with check (public.is_member());

alter publication supabase_realtime add table board_filters;
