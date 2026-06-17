-- 0004_rpc_realtime.sql
-- Founder onboarding (resolves the members.id -> auth.users(id) FK ordering),
-- the client-facing RPCs (advance_ticket, decide_approval), and Realtime wiring.

-- ── member_invites: deploy-time allowlist of who may become a member ──
-- Seeded at deploy from env (never commit real emails). Only emails present
-- here become members on sign-in; everyone else is gated out. This is the
-- admin-only gate at the data layer.
create table member_invites (
  email text primary key,
  handle text not null,
  full_name text not null,
  role text not null default 'founder',
  avatar_color text
);
alter table member_invites enable row level security;
create policy member_invites_founder on member_invites
  for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

-- ── handle_new_user: on signup, promote allowlisted emails to members ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare inv public.member_invites%rowtype;
begin
  select * into inv from public.member_invites where email = new.email;
  if found then
    insert into public.members (id, handle, full_name, email, role, avatar_color)
    values (new.id, inv.handle, inv.full_name, new.email, inv.role, inv.avatar_color)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── advance_ticket: the Kanban action surface (Section 10.3) ──────
-- Updates the ticket and emits ticket.advanced; the events INSERT drives the
-- event-processor (rules engine) downstream. Runs as the calling member.
create or replace function public.advance_ticket(p_ticket_id uuid, p_to_stage text)
returns tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  t tickets;
  from_stage text;
  handle text;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;

  select m.handle into handle from public.members m where m.id = auth.uid();

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;

  from_stage := t.stage;

  update public.tickets
    set stage = p_to_stage,
        stage_changed_at = now(),
        closed_at = case when p_to_stage = 'done' then now() else null end
    where id = p_ticket_id
    returning * into t;

  insert into public.events (type, build_id, actor, entity_type, entity_id, payload)
  values (
    'ticket.advanced',
    t.build_id,
    'human:' || coalesce(handle, 'unknown'),
    'ticket',
    t.id,
    jsonb_build_object(
      'from_stage', from_stage,
      'to_stage', p_to_stage,
      'ticket', to_jsonb(t)
    )
  );

  return t;
end;
$$;

-- ── decide_approval: any active member may decide; stamps who acted ──
create or replace function public.decide_approval(p_approval_id uuid, p_decision text)
returns approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  a approvals;
  handle text;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  select m.handle into handle from public.members m where m.id = auth.uid();

  update public.approvals
    set status = p_decision,
        decided_by = 'human:' || coalesce(handle, 'unknown'),
        decided_at = now()
    where id = p_approval_id and status = 'pending'
    returning * into a;

  if not found then raise exception 'approval not pending or not found'; end if;

  insert into public.action_log (event_id, rule_id, action_type, status, actor, build_id, summary, after_state)
  values (
    a.event_id, a.rule_id, 'approval.decided', p_decision,
    'human:' || coalesce(handle, 'unknown'), a.build_id,
    format('Approval %s: %s', p_decision, a.title), to_jsonb(a)
  );

  return a;
end;
$$;

-- ── Realtime: publish domain tables for <1s live UI updates ───────
do $$
declare t text;
begin
  foreach t in array array[
    'builds','tickets','expenses','revenue_entries','prospects','feedback',
    'agents','agent_runs','events','rules','action_log','approvals',
    'connections','metric_snapshots','milestones','briefings','decisions','learnings'
  ]
  loop
    execute format('alter publication supabase_realtime add table %I;', t);
  end loop;
end $$;
