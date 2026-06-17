# JARVIS

Autonomous command & control center for **Brilliant Disruptions** — an auth-gated,
admin-only mission-control app wired to live Supabase data. Built from
`JARVIS_SPEC.md` (Phases 0–1). Next.js 16 (App Router) + Supabase + TanStack Query
+ Zustand, styled to the marketing site's cyan/void aesthetic.

## What's here (Phases 0–1)

- **Auth + admin gate.** Supabase Auth; access requires an active `members` row.
  Non-members are signed out with "not authorized" (`proxy.ts` redirects
  unauthenticated users; `app/(app)/layout.tsx` enforces membership).
- **Full schema + RLS** for every domain table (`supabase/migrations/`), append-only
  `action_log`, `decide_approval`/`advance_ticket` RPCs, Realtime publication.
- **Event spine.** `events` INSERT → `event-processor` Edge Function (rules engine §6.4
  + low-risk action layer) via a `pg_net` trigger, with a `pg_cron` drain fallback.
- **All 10 tabs** read live data via TanStack Query + Realtime (<1s updates).
- **Kanban cascade** — drag a ticket to Done → `advance_ticket` → `ticket.advanced`
  event → rules cascade (recompute health → notify → audit) with a live toast trail
  and rollback on failure.
- **Command bar + ai-gateway** Edge Function (Claude, server-side key, live build
  snapshot injection).
- **No product/build names hardcoded** anywhere — builds are data; first run shows an
  onboarding empty state.

## Local development

```bash
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
npm install
npm run dev                  # http://localhost:3000
npm test                     # rules engine + health-score unit tests
```

Supabase project ref: `kihctocqvuewjxmpoxcw`. Migrations in `supabase/migrations/`
are already applied to it. Edge functions (`supabase/functions/`) are deployed.

## Founder onboarding (deploy-time)

Founder emails are **never committed**. Seed the invite allowlist with real
addresses, then have each founder sign up — the `handle_new_user()` trigger
promotes invited emails to active members:

```bash
psql "$SUPABASE_DB_URL" \
  -v wilt="$FOUNDER_EMAIL_WILT" \
  -v ahrens="$FOUNDER_EMAIL_AHRENS" \
  -v neyhart="$FOUNDER_EMAIL_NEYHART" \
  -f supabase/seed_invites.example.sql
```

## Deploy (user actions)

1. **Vercel** — import `jarvis-app/` as a project; set `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. (Server-only `ANTHROPIC_API_KEY` etc. go in
   Supabase Edge Function secrets, not Vercel.)
2. **DNS** — point `jarvis.brilliantdisruptions.com` (CNAME → Vercel).
3. **Edge function secrets** — set `ANTHROPIC_API_KEY` (and Phase 2+ keys) on the
   Supabase project so the command bar / agents can call Claude.

## Out of scope here (Phase 2+)

GitHub/Stripe/Mercury/Gmail adapters, the approvals tray UI, agent fleet execution,
and the premortem/postmortem loop. Their schema exists; wiring does not.
