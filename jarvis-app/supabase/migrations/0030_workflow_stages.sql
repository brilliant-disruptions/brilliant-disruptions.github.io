-- ── workflow_stages: per-build (or global) custom stage definitions per
--    item_type. Empty by default — no rows for a build/item_type means "use
--    the app's hardcoded defaults" (see lib/board-constants.ts resolveStages),
--    so every existing build keeps working unchanged until customized. ──
create table workflow_stages (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,
  item_type text not null,                       -- ticket|epic|initiative
  key text not null,
  label text not null,
  sort_order int not null default 0,
  is_terminal boolean not null default false,    -- counts as "done" for closed_at/metrics
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (build_id, item_type, key)
);

alter table workflow_stages enable row level security;

create policy member_select on workflow_stages for select to authenticated using (public.is_member());
create policy member_write on workflow_stages for all to authenticated
  using (public.is_member()) with check (public.is_member());

create trigger trg_workflow_stages_updated_at before update on workflow_stages
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table workflow_stages;

-- ── advance_ticket: same transition/gating enforcement as 0029, but closed_at
--    now derives from the build's configured is_terminal stage (falling back
--    to the literal 'done' when no workflow_stages rows exist for this
--    build/item_type, matching the hardcoded-default fallback everywhere else). ──
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
