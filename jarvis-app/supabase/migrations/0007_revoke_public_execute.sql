-- 0007_revoke_public_execute.sql
-- Default Postgres grants EXECUTE to PUBLIC, which `anon` inherits. Revoke from
-- PUBLIC and re-grant only to `authenticated` (members self-guard inside the
-- function; RLS evaluation needs authenticated EXECUTE on the helpers).
--
-- The remaining advisor WARN (0029 "signed-in users can execute SECURITY
-- DEFINER") on these four functions is INTENTIONAL: members must be able to call
-- advance_ticket / decide_approval, and RLS policies require authenticated to
-- execute is_member / is_founder.
revoke execute on function public.advance_ticket(uuid, text) from public;
revoke execute on function public.decide_approval(uuid, text) from public;
revoke execute on function public.is_member() from public;
revoke execute on function public.is_founder() from public;

grant execute on function public.advance_ticket(uuid, text) to authenticated;
grant execute on function public.decide_approval(uuid, text) to authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_founder() to authenticated;
