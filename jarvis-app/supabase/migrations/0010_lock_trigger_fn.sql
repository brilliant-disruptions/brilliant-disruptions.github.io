-- 0010_lock_trigger_fn.sql
-- on_event_insert is a trigger-only function; it must not be REST-callable.
revoke execute on function public.on_event_insert() from anon, authenticated, public;
