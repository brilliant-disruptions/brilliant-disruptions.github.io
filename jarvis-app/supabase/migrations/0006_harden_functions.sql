-- 0006_harden_functions.sql
-- Address Supabase security-advisor WARN lints (Section 9 posture).

-- Fix mutable search_path on the one function that lacked it.
alter function public.set_updated_at() set search_path = public;

-- Trigger-only functions must never be callable via the REST RPC surface.
revoke execute on function public.set_updated_at() from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Guarded RPCs self-check is_member() and are meant for signed-in members only.
revoke execute on function public.advance_ticket(uuid, text) from anon;
revoke execute on function public.decide_approval(uuid, text) from anon;

-- Access-spine helpers: needed by authenticated RLS evaluation; not for anon.
revoke execute on function public.is_member() from anon;
revoke execute on function public.is_founder() from anon;
