-- 0009_invite_only_signup.sql
-- Enforce invite-only at the data layer: reject any new auth account whose email
-- is not on the member_invites allowlist. Stronger than the dashboard "disable
-- signups" toggle because it holds for every path (public signup, OAuth, magic
-- link) and can only be bypassed by adding an invite first.
create or replace function public.enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.member_invites where email = new.email) then
    raise exception 'Sign-ups are invite-only. % is not on the allowlist.', new.email
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_invite_only
  before insert on auth.users
  for each row execute function public.enforce_invite_only();

revoke execute on function public.enforce_invite_only() from anon, authenticated, public;
