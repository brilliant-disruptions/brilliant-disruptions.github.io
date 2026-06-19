-- 0017_request_agent_run.sql
-- Let members dispatch an agent from the UI (spec §10.1 dispatch panel).
--
-- Clients cannot insert into `events` directly (RLS: events are written by the
-- service role only). So this SECURITY DEFINER RPC is the audited entry point:
-- it validates the agent exists, stamps the requesting member as actor, and
-- emits an `agent.dispatch_requested` event. The on_event_insert trigger (0008)
-- then fires the event-processor, which routes it to dispatchAgent.

create or replace function public.request_agent_run(p_slug text, p_input jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_handle text;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.agents where slug = p_slug) then
    raise exception 'unknown agent: %', p_slug;
  end if;

  select handle into v_handle from public.members where id = auth.uid();
  insert into public.events (type, actor, entity_type, payload)
  values (
    'agent.dispatch_requested',
    'human:' || coalesce(v_handle, 'unknown'),
    'agent',
    jsonb_build_object('agent_slug', p_slug, 'input', coalesce(p_input, '{}'::jsonb))
  );
end;
$$;

revoke execute on function public.request_agent_run(text, jsonb) from public, anon;
grant  execute on function public.request_agent_run(text, jsonb) to authenticated;
