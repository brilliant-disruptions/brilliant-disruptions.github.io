-- 0014_maps_connection.sql
-- Add Google Maps as a managed connection so its API key can be set in the
-- Connections UI (Vault-backed, like every other provider). The prospecting
-- agent reads GOOGLE_MAPS_API_KEY to scrape target businesses (gated until set).
--
-- Idempotent: 0005 already seeded the other providers; this only adds 'maps'.
insert into public.connections (provider, status, display_name, description, sync_frequency)
values ('maps', 'disconnected', 'Google Maps', 'Business discovery for prospecting (Places).', '1h')
on conflict (provider) do nothing;
