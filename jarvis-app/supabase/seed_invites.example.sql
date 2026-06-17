-- Founder onboarding (run once at deploy; DO NOT commit real emails).
-- Seeds the member_invites allowlist. When each founder signs up with their real
-- email, the handle_new_user() trigger promotes them to an active `members` row.
-- Replace the emails with the real founder addresses at deploy time.
--
--   psql "$SUPABASE_DB_URL" -v wilt="$FOUNDER_EMAIL_WILT" \
--        -v ahrens="$FOUNDER_EMAIL_AHRENS" -v neyhart="$FOUNDER_EMAIL_NEYHART" \
--        -f supabase/seed_invites.example.sql

insert into member_invites (email, handle, full_name, role, avatar_color) values
  (:'wilt',    'wilt',    'Michael Wilt', 'founder', '#00e5ff'),
  (:'ahrens',  'ahrens',  'Nick Ahrens',  'founder', '#7c3aed'),
  (:'neyhart', 'neyhart', 'Jimmy Neyhart', 'founder', '#00ff88')
on conflict (email) do update
  set handle = excluded.handle,
      full_name = excluded.full_name,
      role = excluded.role,
      avatar_color = excluded.avatar_color;
