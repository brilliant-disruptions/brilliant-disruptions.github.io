-- 0021_github_open_prs.sql
-- Org-wide open PR feed for the Overview "Needs Attention" inbox. Unlike
-- repo_activity (scoped to tracked builds), this covers every repo in the
-- brilliant-disruptions org, tracked or not — build_id is nullable and only
-- populated when the repo happens to match a tracked build (for the color dot).
-- Populated by the github adapter's ?sync= reconcile, which replaces the set of
-- open, non-draft PRs each run (rows for merged/closed/re-drafted PRs are
-- deleted). Read-only to clients; the service role writes it, like repo_activity.

create table public.github_open_prs (
  id          uuid primary key default gen_random_uuid(),
  build_id    uuid references public.builds(id) on delete set null,
  repo        text not null,                    -- "brilliant-disruptions/apps"
  external_id text not null unique,              -- PR node_id (idempotency key)
  number      int not null,
  title       text not null,
  author      text,
  url         text,
  draft       boolean not null default false,
  updated_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index github_open_prs_updated_idx on public.github_open_prs (updated_at desc);

alter table public.github_open_prs enable row level security;

-- Members read; no client write policy → only the service role (adapter) writes.
create policy github_open_prs_select on public.github_open_prs
  for select to authenticated using (public.is_member());

-- Live updates on the inbox as PRs open/merge/close.
alter publication supabase_realtime add table github_open_prs;
