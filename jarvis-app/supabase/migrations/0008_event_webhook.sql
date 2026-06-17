-- 0008_event_webhook.sql
-- Wire events INSERT -> event-processor (mechanism A) + pg_cron drain (§6.3).
-- The processor's verify_jwt only needs a valid project JWT at the gateway; the
-- function uses its own service-role key internally, so the (public) anon JWT is
-- used here as the bearer. Both are kept in Vault rather than inlined.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- NOTE: replace these Vault values for a fresh project (the URL/key are
-- project-specific). They are NOT secrets beyond what's already public (anon key).
select vault.create_secret(
  'https://kihctocqvuewjxmpoxcw.supabase.co/functions/v1',
  'functions_base_url',
  'Base URL for JARVIS edge functions'
);
select vault.create_secret(
  '<PROJECT_ANON_JWT>',  -- set to the project anon (legacy JWT) key
  'functions_bearer',
  'Project anon JWT used to call edge functions from the DB'
);

create or replace function public.on_event_insert()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  base_url text;
  bearer text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'functions_base_url';
  select decrypted_secret into bearer from vault.decrypted_secrets where name = 'functions_bearer';
  perform net.http_post(
    url := base_url || '/event-processor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer
    ),
    body := jsonb_build_object('record', jsonb_build_object('id', NEW.id))
  );
  return NEW;
end;
$$;

create trigger trg_events_dispatch
  after insert on public.events
  for each row execute function public.on_event_insert();

-- Resilience drain every minute (§6.3-B): processes events the webhook missed.
select cron.schedule(
  'jarvis-event-drain',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/event-processor?drain=true',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'functions_bearer')
      ),
      body := '{}'::jsonb
    );
  $$
);
