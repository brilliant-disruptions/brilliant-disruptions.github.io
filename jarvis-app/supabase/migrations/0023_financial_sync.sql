-- 0023_financial_sync.sql
-- Unified financial health: Relay (via Plaid), Stripe pull-sync, QuickBooks Online.
--
-- No new tables. Institutional metrics ride on metric_snapshots, whose unique
-- index (coalesce(build_id::text,'portfolio'), metric, captured_on) makes a
-- daily upsert naturally idempotent:
--   cash                     bank sync (Plaid or Mercury)   meta: per-account balances
--   stripe_balance           Stripe                          meta: available/pending
--   stripe_payouts_30d       Stripe                          meta: payout count
--   qb_revenue_mtd           QBO ProfitAndLoss               meta: period start/end
--   qb_expenses_mtd          QBO ProfitAndLoss
--   qb_net_income_mtd        QBO ProfitAndLoss
--   qb_ar_total / qb_ar_overdue   QBO AgedReceivables        meta: bucket breakdown
--   qb_ap_total              QBO AgedPayables
--
-- expenses.source / revenue_entries.source are free text (no check constraint),
-- so 'plaid' and 'quickbooks' need no DDL — only the comments below.

comment on column public.expenses.source is
  'manual|stripe|mercury|plaid|quickbooks — origin of the row; adapter-drafted rows also set external_id for idempotency.';
comment on column public.revenue_entries.source is
  'manual|invoice|stripe|quickbooks — origin of the entry; adapter rows set external_id for idempotency.';

-- ── write_secret: service-role-only Vault write ────────────────────
-- QuickBooks rotates its refresh token on EVERY refresh; the new one must be
-- persisted or the connection dies (and after 100 days of no refresh it dies
-- anyway). The existing write path (set_connection_secret, 0013) is founder-
-- gated on auth.uid() and therefore unusable from an edge function, so this is
-- the machine equivalent: same Vault upsert, same last-4 hint, but locked to
-- service_role and with NO founder check (edge functions have no user).
create or replace function public.write_secret(
  p_provider text,
  p_key_name text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  if coalesce(p_value, '') = '' then
    raise exception 'value is required';
  end if;

  select id into v_id from vault.secrets where name = p_key_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_key_name, format('Integration secret for %s (rotated by adapter)', p_provider));
  else
    -- Name passed explicitly for the same reason as 0013: some vault versions
    -- assign rather than coalesce new_name, which would break read_secret.
    perform vault.update_secret(v_id, p_value, p_key_name);
  end if;

  update public.connections
    set config = jsonb_set(
          coalesce(config, '{}'::jsonb),
          array['secrets', p_key_name],
          jsonb_build_object('last4', right(p_value, 4), 'set_at', now()::text),
          true
        ),
        updated_at = now()
    where provider = p_provider;

  -- Audited without the value, like set_connection_secret.
  insert into public.action_log (action_type, status, actor, summary)
  values ('connection.secret_rotated', 'success', 'system:' || p_provider,
          format('Rotated %s secret %s', p_provider, p_key_name));
end;
$$;

revoke execute on function public.write_secret(text, text, text) from public, anon, authenticated;
grant execute on function public.write_secret(text, text, text) to service_role;

-- ── Make the daily metric upsert actually upsertable ───────────────
-- 0002 guards uniqueness with an EXPRESSION index on
-- (coalesce(build_id::text,'portfolio'), metric, captured_on). PostgREST's
-- on_conflict can only name real columns, so no adapter could ever say
-- ON CONFLICT ... DO UPDATE against it — the second sync of any given day hit a
-- 23505 instead of refreshing the value. `nulls not distinct` (PG15+) gives an
-- equivalent guarantee over plain columns, including the portfolio rows where
-- build_id is null. The 0002 index stays; it is redundant, not wrong.
create unique index if not exists metric_snapshots_day_uniq
  on public.metric_snapshots (build_id, metric, captured_on) nulls not distinct;

-- ── New connection providers ───────────────────────────────────────
-- Idempotent so a re-apply is a no-op (provider is unique).
insert into connections (provider, status, display_name, description, sync_frequency) values
  ('plaid',      'pending', 'Relay / Plaid',      'Bank cash on hand + auto-drafted expenses via Plaid.', '4h'),
  ('quickbooks', 'pending', 'QuickBooks Online',  'P&L, balance sheet, A/R and A/P aging.',               '6h')
on conflict (provider) do nothing;

-- ── JARVIS_SYNC_KEY: gates the ?sync=true routes ───────────────────
-- `functions_bearer` (0008) is the project ANON key, which ships in the browser
-- bundle — so verify_jwt alone would leave every financial sync route publicly
-- callable. pg_cron additionally sends this random server-only key as
-- X-Sync-Key, and the adapters fail closed without it. Generated here so it is
-- never typed, pasted, or committed.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'JARVIS_SYNC_KEY') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'JARVIS_SYNC_KEY',
      'Shared secret required on edge-function ?sync=true routes'
    );
  end if;
end $$;

-- ── Sync schedules ─────────────────────────────────────────────────
-- Same shape as 0019 (github): functions base URL + bearer from Vault, POST
-- ?sync=true. cron.schedule is idempotent by jobname. Each function degrades to
-- a recorded sync.failed when its keys are unset, so these are harmless no-ops
-- until the Connections UI has credentials.
select cron.schedule(
  'jarvis-bank-sync',
  '17 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/bank?sync=true',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'functions_bearer'),
        'X-Sync-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'JARVIS_SYNC_KEY')
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule(
  'jarvis-stripe-sync',
  '32 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/stripe-sync?sync=true',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'functions_bearer'),
        'X-Sync-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'JARVIS_SYNC_KEY')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Every 6h. Also the thing that keeps the QuickBooks refresh token alive (it
-- expires after 100 days without a refresh), so do not lengthen this much.
select cron.schedule(
  'jarvis-quickbooks-sync',
  '47 */6 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url') || '/quickbooks?sync=true',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'functions_bearer'),
        'X-Sync-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'JARVIS_SYNC_KEY')
      ),
      body := '{}'::jsonb
    );
  $$
);
