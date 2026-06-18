-- 0012_rules_config_authoring.sql
-- Phase 4: rule authoring from the UI + medium-risk gating config (§7.3, §10.10).
--
-- 1. rules.config — per-rule knobs. `auto_approve_medium=true` lets a rule's
--    medium-risk actions run automatically; otherwise medium gates (§7.3).
-- 2. Backfill: the autonomous agent.dispatch rules (non-gated) must keep running
--    automatically once medium gates by default — otherwise the
--    decision.opened → premortem dispatch would create an approval, which emits
--    a fresh decision.opened, which matches again … a runaway loop. We gate the
--    high-risk *output* of an agent, never the dispatch itself.
-- 3. upsert_rule / set_rule_enabled — SECURITY DEFINER RPCs so any active member
--    can author rules from the Rules UI (no direct client write on `rules`).

alter table public.rules
  add column if not exists config jsonb not null default '{}';

-- Autonomous dispatch rules: any non-gated rule that dispatches an agent runs
-- the dispatch automatically. Identified structurally (not by name) so it stays
-- correct if names change.
update public.rules r
  set config = r.config || '{"auto_approve_medium": true}'::jsonb
  where r.requires_approval = false
    and exists (
      select 1 from jsonb_array_elements(r.actions) a
      where a->>'type' = 'agent.dispatch'
    );

-- ── upsert_rule: create (p_id null) or update a rule ──────────────
create or replace function public.upsert_rule(
  p_id uuid,
  p_name text,
  p_description text,
  p_trigger_event text,
  p_build_scope text,
  p_conditions jsonb,
  p_actions jsonb,
  p_requires_approval boolean,
  p_auto_approve_medium boolean,
  p_priority int,
  p_is_enabled boolean
)
returns public.rules
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rules;
  cfg jsonb := jsonb_build_object('auto_approve_medium', coalesce(p_auto_approve_medium, false));
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;
  if coalesce(p_name, '') = '' or coalesce(p_trigger_event, '') = '' then
    raise exception 'name and trigger_event are required';
  end if;

  if p_id is null then
    insert into public.rules
      (name, description, trigger_event, build_scope, conditions, actions,
       requires_approval, config, priority, is_enabled)
    values
      (p_name, p_description, p_trigger_event, coalesce(p_build_scope, 'all'),
       coalesce(p_conditions, '[]'::jsonb), coalesce(p_actions, '[]'::jsonb),
       coalesce(p_requires_approval, false), cfg, coalesce(p_priority, 100),
       coalesce(p_is_enabled, true))
    returning * into r;
  else
    update public.rules
      set name = p_name,
          description = p_description,
          trigger_event = p_trigger_event,
          build_scope = coalesce(p_build_scope, 'all'),
          conditions = coalesce(p_conditions, '[]'::jsonb),
          actions = coalesce(p_actions, '[]'::jsonb),
          requires_approval = coalesce(p_requires_approval, false),
          config = config || cfg,
          priority = coalesce(p_priority, 100),
          is_enabled = coalesce(p_is_enabled, true),
          updated_at = now()
      where id = p_id
      returning * into r;
    if not found then raise exception 'rule not found'; end if;
  end if;

  return r;
end;
$$;

-- ── set_rule_enabled: quick enable/disable toggle ────────────────
create or replace function public.set_rule_enabled(p_id uuid, p_enabled boolean)
returns public.rules
language plpgsql
security definer
set search_path = public
as $$
declare r public.rules;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;
  update public.rules
    set is_enabled = p_enabled, updated_at = now()
    where id = p_id
    returning * into r;
  if not found then raise exception 'rule not found'; end if;
  return r;
end;
$$;

-- Mirror the 0007 grant posture: revoke from PUBLIC, grant to authenticated
-- (the functions self-guard with is_member()).
revoke execute on function public.upsert_rule(uuid, text, text, text, text, jsonb, jsonb, boolean, boolean, int, boolean) from public;
revoke execute on function public.set_rule_enabled(uuid, boolean) from public;
grant execute on function public.upsert_rule(uuid, text, text, text, text, jsonb, jsonb, boolean, boolean, int, boolean) to authenticated;
grant execute on function public.set_rule_enabled(uuid, boolean) to authenticated;
