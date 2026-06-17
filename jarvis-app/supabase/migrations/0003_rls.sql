-- 0003_rls.sql
-- RLS on every table (Section 9). The company owns the data, not any individual:
-- any authenticated, active member reads all domain data and (in v1) writes all
-- domain data. action_log is append-only. events/rules/approvals are written only
-- by the service role (Edge Functions); clients read them.

-- ── Access-spine helpers ──────────────────────────────────────────
-- SECURITY DEFINER so they bypass RLS on members (prevents policy recursion).
create or replace function public.is_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.is_founder()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.members
    where id = auth.uid() and is_active and role = 'founder'
  );
$$;

-- ── Enable RLS everywhere ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'members','builds','tickets','expenses','revenue_entries','prospects',
    'feedback','agents','agent_runs','events','rules','action_log','approvals',
    'connections','metric_snapshots','milestones','briefings','decisions','learnings'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ── Domain tables: members read + write all (v1) ──────────────────
-- Service role bypasses RLS, so Edge Functions are unaffected by these.
do $$
declare t text;
begin
  foreach t in array array[
    'builds','tickets','expenses','revenue_entries','prospects','feedback',
    'agents','agent_runs','connections','metric_snapshots','milestones',
    'briefings','decisions','learnings'
  ]
  loop
    execute format(
      'create policy member_select on %I for select to authenticated using (public.is_member());', t);
    execute format(
      'create policy member_write on %I for all to authenticated
         using (public.is_member()) with check (public.is_member());', t);
  end loop;
end $$;

-- ── members: everyone active reads the roster; founders manage it ──
create policy members_select on members
  for select to authenticated using (public.is_member());
create policy members_manage on members
  for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

-- ── events / rules / approvals: read-only to clients ──────────────
-- Writes happen via the service role (Edge Functions); approvals are decided
-- through the decide_approval() SECURITY DEFINER RPC (0004), not direct UPDATE.
create policy events_select on events
  for select to authenticated using (public.is_member());
create policy rules_select on rules
  for select to authenticated using (public.is_member());
create policy approvals_select on approvals
  for select to authenticated using (public.is_member());

-- ── action_log: append-only audit. Clients SELECT only; no client
--    INSERT/UPDATE/DELETE policy exists, so only the service role writes. ──
create policy action_log_select on action_log
  for select to authenticated using (public.is_member());
