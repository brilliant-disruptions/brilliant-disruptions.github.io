-- 0015_user_audit.sql
-- Comprehensive user-activity audit trail (spec §0.4, §10.9).
--
-- Until now action_log only captured what the event-processor/rules engine did.
-- A member logging an expense or creating an issue is a direct insert (RLS), so
-- it left NO audit trail. This migration closes that gap: every member write to a
-- user-input table, plus logins, is recorded to the append-only action_log.
--
-- Two design points that make this correct rather than noisy:
--   1. SECURITY DEFINER is mandatory — action_log has no client INSERT policy, so
--      a trigger running as the invoking member is blocked by RLS. Definer-owned
--      (postgres) bypasses it, matching the "service role writes the audit" model.
--   2. auth.uid() guard — service-role/edge writes (agents, adapters, GitHub sync)
--      have no auth.uid() and are ALREADY logged via the event bus. Logging them
--      here too would double-count. auth.uid() reads the JWT claim, so it survives
--      SECURITY DEFINER and is non-null only for a real in-session member write.

create or replace function public.log_user_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle  text;
  v_actor   text;
  v_action  text;
  v_summary text;
  v_build   uuid;
begin
  -- Only audit in-session member writes; edge/agent writes go through events.
  if auth.uid() is null then
    return coalesce(NEW, OLD);
  end if;

  select handle into v_handle from public.members where id = auth.uid();
  v_actor := 'human:' || coalesce(v_handle, 'unknown');

  if TG_TABLE_NAME = 'builds' then
    if TG_OP = 'DELETE' then
      -- build_id must stay NULL here: action_log.build_id FKs builds(id), and the
      -- build row is already gone in an AFTER DELETE trigger, so referencing
      -- OLD.id would FK-violate and abort the delete. The name lives in the
      -- summary + after_state instead.
      v_build := null;
      v_action := 'build.deleted';
      v_summary := format('Deleted build "%s"', OLD.name);
    elsif TG_OP = 'UPDATE' then
      v_build := NEW.id;
      v_action := 'build.edited';
      v_summary := format('Edited build "%s"', NEW.name);
    else
      v_build := NEW.id;
      v_action := 'build.created';
      v_summary := format('Created build "%s"', NEW.name);
    end if;
  elsif TG_TABLE_NAME = 'tickets' then
    v_build := NEW.build_id;
    if TG_OP = 'INSERT' then
      v_action := 'ticket.created';
      v_summary := format('Created issue "%s"', NEW.title);
    else
      v_action := 'ticket.edited';
      v_summary := format('Edited issue "%s"', NEW.title);
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    v_build := NEW.build_id;
    v_action := 'expense.logged';
    v_summary := format('Logged expense: %s ($%s%s)',
                        coalesce(NEW.vendor, '—'),
                        to_char(NEW.amount_cents / 100.0, 'FM999990.00'),
                        case when NEW.is_recurring then '/' || coalesce(NEW.recurrence, 'mo') else '' end);
  elsif TG_TABLE_NAME = 'feedback' then
    v_build := NEW.build_id;
    v_action := 'feedback.added';
    v_summary := format('Added feedback: %s', NEW.summary);
  elsif TG_TABLE_NAME = 'prospects' then
    v_build := NEW.build_id;
    v_action := 'prospect.added';
    v_summary := format('Added prospect: %s', NEW.company);
  else
    return coalesce(NEW, OLD);
  end if;

  insert into public.action_log (action_type, status, actor, build_id, summary, after_state)
  values (v_action, 'success', v_actor, v_build, v_summary, coalesce(to_jsonb(NEW), to_jsonb(OLD)));

  return coalesce(NEW, OLD);
end;
$$;

-- INSERT triggers: these tables have zero existing user-write coverage, so the
-- trigger is the only logger — no duplication risk.
create trigger log_build_insert    after insert on public.builds    for each row execute function public.log_user_action();
create trigger log_ticket_insert   after insert on public.tickets   for each row execute function public.log_user_action();

-- Build edits + deletes are significant and worth auditing. The auth.uid() guard
-- excludes service-role writes (e.g. health_score recompute) automatically.
create trigger log_build_update    after update on public.builds    for each row execute function public.log_user_action();
create trigger log_build_delete    after delete on public.builds    for each row execute function public.log_user_action();
create trigger log_expense_insert  after insert on public.expenses  for each row execute function public.log_user_action();
create trigger log_feedback_insert after insert on public.feedback  for each row execute function public.log_user_action();
create trigger log_prospect_insert after insert on public.prospects for each row execute function public.log_user_action();

-- UPDATE trigger on tickets: capture description/type/priority edits (the drawer)
-- WITHOUT double-logging stage changes — those flow through advance_ticket, which
-- emits ticket.advanced and is logged by the event-processor. Guard: stage equal.
create trigger log_ticket_update after update on public.tickets
  for each row when (NEW.stage = OLD.stage)
  execute function public.log_user_action();

-- ── log_login: best-effort sign-in audit (called once per session by the app) ──
-- Best-effort and client-triggered (not tamper-proof), which is fine for a small
-- internal tool — it answers "who has been signing in" on the Activity tab.
create or replace function public.log_login()
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
  select handle into v_handle from public.members where id = auth.uid();
  insert into public.action_log (action_type, status, actor, summary)
  values ('auth.login', 'success', 'human:' || coalesce(v_handle, 'unknown'), 'Signed in');
end;
$$;

-- Harden (per 0006): the trigger fn is never REST-callable; log_login is members-only.
revoke execute on function public.log_user_action() from public, anon, authenticated;
revoke execute on function public.log_login() from public, anon;
grant  execute on function public.log_login() to authenticated;
