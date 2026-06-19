-- 0018_revoke_anon_execute.sql
-- Defense-in-depth: 0012/0013 revoked these mutating SECURITY DEFINER RPCs from
-- PUBLIC and granted authenticated, but did not explicitly revoke `anon`. They
-- already self-guard (is_member()/is_founder() → anon gets "not authorized"), so
-- this is not a live exposure — but the advisor flags the grant, and matching the
-- locked-down read_secret posture is the right, consistent thing. No anon path
-- should reach a rule/connection/secret mutation.

revoke execute on function public.upsert_rule(uuid, text, text, text, text, jsonb, jsonb, boolean, boolean, int, boolean) from anon;
revoke execute on function public.set_rule_enabled(uuid, boolean) from anon;
revoke execute on function public.set_connection(text, text, text) from anon;
revoke execute on function public.set_connection_secret(text, text, text) from anon;
revoke execute on function public.delete_connection_secret(text, text) from anon;
