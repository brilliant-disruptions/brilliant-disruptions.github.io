-- 0013_connection_secrets.sql
-- UI-managed integration secrets (§9: secrets in Vault, never in the client).
--
-- Write path (founder-gated): set_connection_secret writes the value into
-- Supabase Vault and stores ONLY a last-4 hint + timestamp in connections.config
-- (client-readable, non-secret). The plaintext value never returns to the
-- browser and is never logged.
--
-- Read path (service-role ONLY): read_secret is how edge functions fetch a
-- secret. The vault schema isn't PostgREST-exposed, so functions call this RPC.
-- It is locked to service_role — a logged-in member must NOT be able to read
-- secrets. This is the inverse of the 0007 authenticated-grant posture and is
-- the whole security model of the feature.

-- ── read_secret: service-role-only secret fetch for edge functions ──
create or replace function public.read_secret(p_name text)
returns text
language sql
security definer
set search_path = public, vault
stable
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

-- Lock it down: revoke the default PUBLIC execute, grant ONLY to service_role.
revoke execute on function public.read_secret(text) from public, anon, authenticated;
grant execute on function public.read_secret(text) to service_role;

-- ── set_connection_secret: founder writes a key into Vault ──────────
-- p_key_name is the secret's Vault name = the env var name the adapter reads
-- (e.g. 'STRIPE_SECRET_KEY'), so getSecret() resolves it by the same name.
create or replace function public.set_connection_secret(
  p_provider text,
  p_key_name text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
  handle text;
begin
  if not public.is_founder() then
    raise exception 'only founders may set integration secrets';
  end if;
  if coalesce(p_value, '') = '' then
    raise exception 'value is required';
  end if;

  select id into v_id from vault.secrets where name = p_key_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_key_name, format('Integration secret for %s (set via Connections UI)', p_provider));
  else
    -- Pass the name explicitly so any vault version that assigns (not coalesces)
    -- new_name can't null it and break read_secret's name lookup.
    perform vault.update_secret(v_id, p_value, p_key_name);
  end if;

  -- Non-secret hint only (last 4) so the UI can show a key is configured.
  update public.connections
    set config = jsonb_set(
          coalesce(config, '{}'::jsonb),
          array['secrets', p_key_name],
          jsonb_build_object('last4', right(p_value, 4), 'set_at', now()::text),
          true
        ),
        status = 'connected',
        updated_at = now()
    where provider = p_provider;
  -- Guard against a typo'd provider leaving a Vault secret with no UI hint.
  if not found then
    raise exception 'unknown connection provider: %', p_provider;
  end if;

  select m.handle into handle from public.members m where m.id = auth.uid();
  -- Audit the act WITHOUT the value (§9 append-only audit).
  insert into public.action_log (action_type, status, actor, summary)
  values ('connection.secret_set', 'success', 'human:' || coalesce(handle, 'unknown'),
          format('Set %s secret %s', p_provider, p_key_name));
end;
$$;

-- ── delete_connection_secret: founder removes a key ────────────────
create or replace function public.delete_connection_secret(p_provider text, p_key_name text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare handle text;
begin
  if not public.is_founder() then
    raise exception 'only founders may remove integration secrets';
  end if;
  delete from vault.secrets where name = p_key_name;
  update public.connections
    set config = (coalesce(config, '{}'::jsonb) #- array['secrets', p_key_name]),
        updated_at = now()
    where provider = p_provider;
  select m.handle into handle from public.members m where m.id = auth.uid();
  insert into public.action_log (action_type, status, actor, summary)
  values ('connection.secret_removed', 'success', 'human:' || coalesce(handle, 'unknown'),
          format('Removed %s secret %s', p_provider, p_key_name));
end;
$$;

-- ── set_connection: connect/disconnect + non-secret config (members) ──
create or replace function public.set_connection(
  p_provider text,
  p_status text,
  p_sync_frequency text
)
returns public.connections
language plpgsql
security definer
set search_path = public
as $$
declare c public.connections;
begin
  if not public.is_member() then
    raise exception 'not authorized';
  end if;
  if p_status is not null and p_status not in ('connected','pending','disconnected','error') then
    raise exception 'invalid status';
  end if;
  update public.connections
    set status = coalesce(p_status, status),
        sync_frequency = coalesce(p_sync_frequency, sync_frequency),
        updated_at = now()
    where provider = p_provider
    returning * into c;
  if not found then raise exception 'connection not found'; end if;
  return c;
end;
$$;

-- Grants mirror 0007 (revoke PUBLIC, grant authenticated; functions self-guard).
revoke execute on function public.set_connection_secret(text, text, text) from public;
revoke execute on function public.delete_connection_secret(text, text) from public;
revoke execute on function public.set_connection(text, text, text) from public;
grant execute on function public.set_connection_secret(text, text, text) to authenticated;
grant execute on function public.delete_connection_secret(text, text) to authenticated;
grant execute on function public.set_connection(text, text, text) to authenticated;
