-- 0024_bd_board.sql
-- Full-replacement Engineering board: initiatives -> epics -> tickets hierarchy,
-- swimlanes, per-item custom fields/templates, and real-member assignment.
-- Ticket stage vocabulary (backlog/in_progress/review/done/archived) and the
-- advance_ticket action surface are unchanged — only widened to also stamp the
-- mover as assignee, so the rules-engine cascade (events -> action_log) keeps
-- working exactly as before.

-- ── initiatives ──────────────────────────────────────────────────
create table initiatives (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'proposed',   -- proposed|scoping|active|validating|shipped
  sort_order int not null default 0,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on initiatives(build_id, status);

-- ── epics ────────────────────────────────────────────────────────
create table epics (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  initiative_id uuid references initiatives(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'backlog',    -- backlog|later|next|now|done
  swimlane text not null default 'product',  -- expedited|product|defects|customer|growth
  sort_order int not null default 0,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on epics(build_id, status);
create index on epics(initiative_id);

-- ── work_item_templates: per-build (or global, build_id null) custom fields ──
create table work_item_templates (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,
  item_type text not null,                   -- ticket|epic|initiative
  fields jsonb not null default '[]',        -- [{key,label,type,required,options}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (build_id, item_type)
);

-- ── tickets: hierarchy, swimlane, points, custom fields, real assignee ──
alter table tickets
  add column epic_id uuid references epics(id) on delete set null,
  add column swimlane text not null default 'product',
  add column sub_status text,
  add column points int,
  add column custom_fields jsonb not null default '{}',
  add column assignee_id uuid references members(id) on delete set null;
create index on tickets(epic_id);

-- assignee was always free text and unused by any RPC/report; superseded by
-- assignee_id (a real FK to members), so it drops rather than migrating data.
alter table tickets drop column assignee;

-- ── RLS: same all-members-read-and-write posture as the rest of the domain ──
alter table initiatives enable row level security;
alter table epics enable row level security;
alter table work_item_templates enable row level security;

create policy member_select on initiatives for select to authenticated using (public.is_member());
create policy member_write on initiatives for all to authenticated
  using (public.is_member()) with check (public.is_member());

create policy member_select on epics for select to authenticated using (public.is_member());
create policy member_write on epics for all to authenticated
  using (public.is_member()) with check (public.is_member());

create policy member_select on work_item_templates for select to authenticated using (public.is_member());
create policy member_write on work_item_templates for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- ── updated_at triggers ──────────────────────────────────────────
create trigger trg_initiatives_updated_at before update on initiatives
  for each row execute function public.set_updated_at();
create trigger trg_epics_updated_at before update on epics
  for each row execute function public.set_updated_at();
create trigger trg_work_item_templates_updated_at before update on work_item_templates
  for each row execute function public.set_updated_at();

-- ── Realtime ─────────────────────────────────────────────────────
alter publication supabase_realtime add table initiatives;
alter publication supabase_realtime add table epics;
alter publication supabase_realtime add table work_item_templates;

-- ── advance_ticket: also stamp the mover as assignee (Section 10.3, revised) ──
-- Unconditional per product decision: whoever moves a ticket to a new stage
-- becomes its assignee, every time — not just when it was previously unassigned.
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
  actor_id uuid;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;

  actor_id := auth.uid();
  select m.handle into handle from public.members m where m.id = actor_id;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;

  from_stage := t.stage;

  update public.tickets
    set stage = p_to_stage,
        assignee_id = actor_id,
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
