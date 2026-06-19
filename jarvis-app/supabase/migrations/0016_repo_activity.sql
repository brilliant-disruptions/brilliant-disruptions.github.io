-- 0016_repo_activity.sql
-- "Updated changes" feed for the Overview build matrix (spec §12.1, §10.1).
-- Stores recent commits + pull requests per build so the matrix shows what's
-- actually moving in each repo, not just a link. Populated by the github adapter
-- (webhook push/pull_request + ?sync= backfill). Read-only to clients; the
-- service role writes it, like action_log/events.

create table public.repo_activity (
  id          uuid primary key default gen_random_uuid(),
  build_id    uuid not null references public.builds(id) on delete cascade,
  kind        text not null check (kind in ('commit', 'pull_request')),
  external_id text not null,                 -- commit sha or PR node_id (idempotency key)
  ref         text,                          -- '#42' for PRs, short sha for commits
  title       text not null,                 -- commit message headline or PR title
  author      text,
  url         text,
  status      text,                          -- PR: open|closed|merged; commit: null
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (external_id)
);

create index repo_activity_build_idx on public.repo_activity (build_id, occurred_at desc);

alter table public.repo_activity enable row level security;

-- Members read; no client write policy → only the service role (adapter) writes.
create policy repo_activity_select on public.repo_activity
  for select to authenticated using (public.is_member());

-- Live updates on the matrix when a webhook lands.
alter publication supabase_realtime add table repo_activity;
