-- 0020_monorepo_builds.sql
-- Monorepo builds: one "apps repo" whose top-level folders each surface as a
-- build (spec §12.1 "build discovery"). A whole-repo build keeps github_path
-- NULL (legacy, 1 repo ↔ 1 build); a folder-build sets github_repo = the apps
-- repo and github_path = the folder name (1 repo ↔ N builds).
--
-- Discovery + folder-rename tracking live in the github adapter's ?sync= pass
-- (functions/github/index.ts → runMonorepoSync). Renames are detected from the
-- GitHub compare API (files[].previous_filename) between the last-synced SHA and
-- HEAD, so a `git mv foo bar` keeps the SAME build row (and its tickets/expenses)
-- — it only updates github_path, never delete-old + add-new.

alter table public.builds
  add column github_path text;                       -- folder within github_repo; NULL = whole-repo build

comment on column public.builds.github_path is
  'Top-level folder inside github_repo for monorepo (folder-as-build) discovery; NULL = whole-repo build.';

-- One build per (apps repo, folder). Makes discovery idempotent: re-running the
-- sync upserts the same row instead of creating duplicates. Partial so legacy
-- whole-repo builds (github_path NULL) are unconstrained.
create unique index builds_repo_path_uniq
  on public.builds (github_repo, github_path)
  where github_path is not null;

-- Designate the apps repo for discovery. Stored in connections.config (not code)
-- so it's overridable without a deploy. The synced-SHA cursor is written at
-- runtime by runMonorepoSync.
update public.connections
  set config = coalesce(config, '{}'::jsonb) || '{"apps_repo": "brilliant-disruptions/apps"}'::jsonb
  where provider = 'github';
