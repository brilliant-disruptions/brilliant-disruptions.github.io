-- 0001_init.sql
-- Shared infrastructure: updated_at trigger function used by every table.
-- gen_random_uuid() is built in (pgcrypto is preinstalled on Supabase).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic trigger: stamps updated_at = now() on every UPDATE.';
