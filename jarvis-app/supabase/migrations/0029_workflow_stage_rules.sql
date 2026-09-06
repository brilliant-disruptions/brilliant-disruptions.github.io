-- ── workflow_stage_rules: per-build (or global) allowed stage transitions,
--    each optionally gated by a custom_fields condition (e.g. a checkbox
--    field must be TRUE before a ticket can move backlog → in_progress) ──
create table workflow_stage_rules (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,
  item_type text not null,                       -- ticket|epic|initiative
  from_stage text not null,
  to_stage text not null,
  gating_conditions jsonb not null default '[]', -- [{field,operator,value}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (build_id, item_type, from_stage, to_stage)
);

alter table workflow_stage_rules enable row level security;

create policy member_select on workflow_stage_rules for select to authenticated using (public.is_member());
create policy member_write on workflow_stage_rules for all to authenticated
  using (public.is_member()) with check (public.is_member());

create trigger trg_workflow_stage_rules_updated_at before update on workflow_stage_rules
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table workflow_stage_rules;

-- ── advance_ticket: enforce allowed transitions + gating conditions when
--    rules are defined for this build/item_type/from_stage. No rows defined
--    for a given from_stage means "unrestricted" (backward compatible). ──
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
      select * from workflow_stage_rules
      where item_type = 'ticket'
        and (build_id = t.build_id or build_id is null)
        and from_stage = t.stage
      order by build_id nulls last
    loop
      -- build_id-specific rule wins over the global (build_id null) one for the same edge
      if rule.to_stage = p_to_stage then
        rule_found := true;
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
        exit;
      end if;
    end loop;

    if not rule_found then
      -- if ANY rule exists for this from_stage (for this build or global) but none
      -- matches p_to_stage, the transition is not allowed
      if exists (
        select 1 from workflow_stage_rules
        where item_type = 'ticket'
          and (build_id = t.build_id or build_id is null)
          and from_stage = t.stage
      ) then
        raise exception 'transition % -> % is not allowed', from_stage, p_to_stage;
      end if;
    end if;
  end if;

  update public.tickets
  set
    stage = p_to_stage,
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
    jsonb_build_object('from_stage', from_stage, 'to_stage', p_to_stage, 'ticket', to_jsonb(t))
  );

  return t;
end;
$$;
