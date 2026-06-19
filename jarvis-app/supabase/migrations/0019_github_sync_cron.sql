-- 0019_github_sync_cron.sql
-- Scheduled GitHub reconcile every 5 min (matches the seeded github
-- connections.sync_frequency of '5m'). Mirrors the event-drain cron (0008):
-- reads the functions base URL + bearer from Vault and POSTs github?sync=true.
-- Degrades safely — with no GITHUB_TOKEN the function records sync.failed and the
-- job is a harmless no-op until a token is set. cron.schedule is idempotent by
-- jobname, so re-applying just updates the schedule.
select cron.schedule(
  'jarvis-github-sync',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/github?sync=true',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'functions_bearer')
      ),
      body := '{}'::jsonb
    );
  $$
);
