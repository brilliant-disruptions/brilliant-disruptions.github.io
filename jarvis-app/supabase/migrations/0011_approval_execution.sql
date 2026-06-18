-- 0011_approval_execution.sql
-- Close the approval loop (spec §6.4, §7.4): approving a gated action must
-- actually run its pending action_spec. plpgsql can't call external APIs, so
-- decide_approval routes execution back through the event bus — on 'approved'
-- it emits an `approval.approved` event. The events INSERT fires the
-- event-processor (Database Webhook), which loads the approval and runs its
-- stored action_spec against the ORIGINAL event's context (§7.4 step 3).
-- Replaces the 0004 definition; the only change is the post-update emit.

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

  -- On approval, emit an event so the event-processor executes the gated
  -- action_spec server-side. Rejections execute nothing (just the audit row
  -- above). Runs as definer, so this INSERT bypasses the events RLS the same
  -- way advance_ticket does.
  if p_decision = 'approved' then
    insert into public.events (type, build_id, actor, entity_type, entity_id, payload)
    values (
      'approval.approved',
      a.build_id,
      'human:' || coalesce(handle, 'unknown'),
      'approval',
      a.id,
      jsonb_build_object('approval_id', a.id, 'title', a.title)
    );
  end if;

  return a;
end;
$$;
