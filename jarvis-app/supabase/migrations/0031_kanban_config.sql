-- ── Configurable Kanban: WIP limits, checklist kill gates, field-requirement
--    movement rules, and configurable swimlanes. Everything here follows the
--    same "empty = hardcoded default wins" pattern as workflow_stages/
--    workflow_stage_rules, so existing builds are unaffected until configured. ──

alter table workflow_stages add column wip_limit int;
alter table workflow_stage_rules add column checklist_items text[] not null default '{}';
alter table workflow_stage_rules add column required_checklist_key text;

-- ── workflow_wip_groups: aggregate WIP limits spanning multiple stages (e.g.
--    "sum of VALIDATING+SPECCING+BUILDING <= 1"), optionally scoped per-owner
--    rather than board-wide. ──
create table workflow_wip_groups (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,
  item_type text not null,                 -- ticket|epic|initiative
  name text not null,
  stage_keys text[] not null default '{}',
  max_count int not null,
  scope text not null default 'board',     -- board|owner
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workflow_wip_groups enable row level security;
create policy member_select on workflow_wip_groups for select to authenticated using (public.is_member());
create policy member_write on workflow_wip_groups for all to authenticated
  using (public.is_member()) with check (public.is_member());
create trigger trg_workflow_wip_groups_updated_at before update on workflow_wip_groups
  for each row execute function public.set_updated_at();
alter publication supabase_realtime add table workflow_wip_groups;

-- ── workflow_field_requirements: "field X must be set to enter/exit stage Y"
--    movement rules (e.g. archived_reason required to enter ARCHIVED,
--    actual_hours required to enter DONE). ──
create table workflow_field_requirements (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,
  item_type text not null,
  stage_key text not null,
  direction text not null,                 -- enter|exit
  field_key text not null,
  field_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workflow_field_requirements enable row level security;
create policy member_select on workflow_field_requirements for select to authenticated using (public.is_member());
create policy member_write on workflow_field_requirements for all to authenticated
  using (public.is_member()) with check (public.is_member());
create trigger trg_workflow_field_requirements_updated_at before update on workflow_field_requirements
  for each row execute function public.set_updated_at();
alter publication supabase_realtime add table workflow_field_requirements;

-- ── workflow_swimlanes: replaces the hardcoded SWIMLANES constant so lane
--    key/label/color/icon become per-build configurable, same shape/pattern
--    as workflow_stages. ──
create table workflow_swimlanes (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,
  key text not null,
  label text not null,
  color text not null default '#6366F1',
  icon text not null default '●',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (build_id, key)
);

alter table workflow_swimlanes enable row level security;
create policy member_select on workflow_swimlanes for select to authenticated using (public.is_member());
create policy member_write on workflow_swimlanes for all to authenticated
  using (public.is_member()) with check (public.is_member());
create trigger trg_workflow_swimlanes_updated_at before update on workflow_swimlanes
  for each row execute function public.set_updated_at();
alter publication supabase_realtime add table workflow_swimlanes;

-- ── advance_ticket: extend with WIP-limit enforcement (per-stage + aggregate
--    groups), checklist-completion enforcement (additive to gating_conditions),
--    and field-requirement enforcement on stage entry/exit. ──
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
  rule workflow_stage_rules;
  rule_found boolean := false;
  cond jsonb;
  field_val jsonb;
  op text;
  to_stage_is_terminal boolean;
  matched_rule workflow_stage_rules;
  checklist_state jsonb;
  item text;
  wip_limit int;
  wip_count int;
  wg workflow_wip_groups;
  req workflow_field_requirements;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;

  actor_id := auth.uid();
  select m.handle into handle from public.members m where m.id = actor_id;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket not found';
  end if;
  from_stage := t.stage;

  if from_stage <> p_to_stage then
    for rule in
      select wsr.* from workflow_stage_rules wsr
      where wsr.item_type = 'ticket'
        and (wsr.build_id = t.build_id or wsr.build_id is null)
        and wsr.from_stage = t.stage
      order by wsr.build_id nulls last
    loop
      -- build_id-specific rule wins over the global (build_id null) one for the same edge
      if rule.to_stage = p_to_stage then
        rule_found := true;
        matched_rule := rule;
        for cond in select * from jsonb_array_elements(rule.gating_conditions)
        loop
          field_val := coalesce(t.custom_fields -> (cond ->> 'field'), 'null'::jsonb);
          op := coalesce(cond ->> 'operator', '==');
          if (op = '==' and field_val <> (cond -> 'value'))
             or (op = '!=' and field_val = (cond -> 'value'))
          then
            raise exception 'gating condition not met: % % %', cond ->> 'field', op, cond -> 'value';
          end if;
        end loop;

        if rule.required_checklist_key is not null and array_length(rule.checklist_items, 1) > 0 then
          checklist_state := coalesce(t.custom_fields -> rule.required_checklist_key, '{}'::jsonb);
          foreach item in array rule.checklist_items loop
            if coalesce((checklist_state -> item)::text, 'false') <> 'true' then
              raise exception 'kill gate checklist item not completed: %', item;
            end if;
          end loop;
        end if;
        exit;
      end if;
    end loop;

    if not rule_found then
      -- if ANY rule exists for this from_stage (for this build or global) but none
      -- matches p_to_stage, the transition is not allowed
      if exists (
        select 1 from workflow_stage_rules wsr
        where wsr.item_type = 'ticket'
          and (wsr.build_id = t.build_id or wsr.build_id is null)
          and wsr.from_stage = t.stage
      ) then
        raise exception 'transition % -> % is not allowed', from_stage, p_to_stage;
      end if;
    end if;
  end if;

  -- field requirements: must hold before leaving from_stage, and before entering p_to_stage
  for req in
    select * from workflow_field_requirements
    where item_type = 'ticket'
      and (build_id = t.build_id or build_id is null)
      and ((direction = 'exit' and stage_key = from_stage) or (direction = 'enter' and stage_key = p_to_stage))
  loop
    if (t.custom_fields -> req.field_key) is null or (t.custom_fields -> req.field_key) = 'null'::jsonb then
      raise exception 'field requirement not met: % is required to % %', req.field_label, req.direction, req.stage_key;
    end if;
  end loop;

  -- per-stage WIP limit on the destination stage
  if from_stage <> p_to_stage then
    select ws.wip_limit into wip_limit
    from workflow_stages ws
    where ws.item_type = 'ticket'
      and (ws.build_id = t.build_id or ws.build_id is null)
      and ws.key = p_to_stage
    order by ws.build_id nulls last
    limit 1;

    if wip_limit is not null then
      select count(*) into wip_count from tickets where build_id = t.build_id and stage = p_to_stage;
      if wip_count >= wip_limit then
        raise exception 'WIP limit reached for stage %: % (limit %)', p_to_stage, wip_count, wip_limit;
      end if;
    end if;

    -- aggregate WIP groups covering the destination stage
    for wg in
      select * from workflow_wip_groups
      where item_type = 'ticket'
        and (build_id = t.build_id or build_id is null)
        and p_to_stage = any(stage_keys)
    loop
      if wg.scope = 'owner' then
        select count(*) into wip_count from tickets
        where build_id = t.build_id and stage = any(wg.stage_keys) and assignee_id = actor_id;
      else
        select count(*) into wip_count from tickets
        where build_id = t.build_id and stage = any(wg.stage_keys);
      end if;
      if wip_count >= wg.max_count then
        raise exception 'WIP limit reached for group %: % (limit %)', wg.name, wip_count, wg.max_count;
      end if;
    end loop;
  end if;

  select ws.is_terminal into to_stage_is_terminal
  from workflow_stages ws
  where ws.item_type = 'ticket'
    and (ws.build_id = t.build_id or ws.build_id is null)
    and ws.key = p_to_stage
  order by ws.build_id nulls last
  limit 1;

  if to_stage_is_terminal is null then
    to_stage_is_terminal := (p_to_stage = 'done');
  end if;

  update public.tickets
  set
    stage = p_to_stage,
    assignee_id = actor_id,
    stage_changed_at = now(),
    closed_at = case when to_stage_is_terminal then now() else null end
  where id = p_ticket_id
  returning * into t;

  insert into public.events (type, build_id, actor, entity_type, entity_id, payload)
  values (
    'ticket.advanced',
    t.build_id,
    'human:' || coalesce(handle, 'unknown'),
    'ticket',
    t.id,
    jsonb_build_object('from_stage', from_stage, 'to_stage', p_to_stage, 'ticket', to_jsonb(t))
  );

  return t;
end;
$$;
