-- 0002_schema.sql
-- All domain tables (JARVIS_SPEC.md Section 5 + 13.2).
-- uuid PKs, timestamptz everywhere, created_at/updated_at + trigger on every
-- mutable table. RLS is enabled in 0003_rls.sql.

-- ── 5.0 members (co-founders / team) ──────────────────────────────
create table members (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null,
  full_name text not null,
  email text unique not null,
  role text not null default 'founder',          -- founder|admin|member
  avatar_color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.1 builds ────────────────────────────────────────────────────
create table builds (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  stage text not null default 'concept',          -- concept|spec|building|gtm|launched|paused|killed
  color text not null default '#00e5ff',
  revenue_model text,                              -- saas|retainer|b2c_sub|b2c_onetime|none
  mrr_target_cents int not null default 0,
  health_score int not null default 0,             -- 0-100, computed (Section 8)
  github_repo text,                                -- "owner/repo" if mapped; null for non-code builds
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.2 tickets ───────────────────────────────────────────────────
create table tickets (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  external_id text,
  external_url text,
  source text not null default 'manual',           -- manual|github|agent
  ref text,
  title text not null,
  description text,
  type text not null default 'bug',                -- bug|feature|perf|security|ux|infra|chore
  priority text not null default 'medium',         -- critical|high|medium|low
  stage text not null default 'backlog',           -- backlog|in_progress|review|done|archived
  assignee text,
  labels text[] default '{}',
  estimate_minutes int,
  is_blocker boolean not null default false,
  blocks_milestone_id uuid,
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tickets(build_id, stage);
create index on tickets(external_id);

-- ── 5.3 expenses ──────────────────────────────────────────────────
create table expenses (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete set null,   -- null = shared/overhead
  source text not null default 'manual',           -- manual|stripe|mercury|plaid
  external_id text,
  vendor text not null,
  category text not null,                           -- infrastructure|ai_api|software_tools|marketing_ads|legal_accounting|hardware|contractor|travel|other
  amount_cents int not null,
  currency text not null default 'usd',
  spent_on date not null default current_date,
  is_recurring boolean not null default false,
  recurrence text,                                  -- monthly|annual|null
  notes text,
  receipt_path text,
  ai_categorized boolean not null default false,
  tax_deductible boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on expenses(build_id, spent_on);

-- ── 5.4 revenue_entries ───────────────────────────────────────────
create table revenue_entries (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  source text not null,                             -- stripe|manual|invoice
  external_id text,
  kind text not null,                              -- subscription|one_time|invoice
  customer_ref text,
  amount_cents int not null,
  mrr_cents int not null default 0,
  currency text not null default 'usd',
  occurred_on date not null default current_date,
  status text not null default 'paid',             -- paid|pending|refunded|failed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on revenue_entries(build_id, occurred_on);

-- ── 5.5 prospects ─────────────────────────────────────────────────
create table prospects (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  company text not null,
  segment text,
  contact_name text,
  contact_email text,
  location text,
  employee_count int,
  source text not null default 'maps_scrape',       -- maps_scrape|referral|inbound|manual
  status text not null default 'new',              -- new|sent|engaged|replied|qualified|call_booked|won|lost
  signal text,
  open_count int not null default 0,
  reply_count int not null default 0,
  last_touch_at timestamptz,
  next_action text,
  next_action_due date,
  gmail_thread_id text,
  booking_clicked boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on prospects(build_id, status);

-- ── 5.6 feedback ──────────────────────────────────────────────────
create table feedback (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references builds(id) on delete cascade,
  source text not null,                            -- internal|beta_user|app_store|email|support
  kind text not null,                              -- bug|feature|perf|ux|praise|complaint
  summary text not null,
  detail text,
  severity text,                                   -- critical|high|medium|low
  sentiment text,                                  -- positive|neutral|negative
  status text not null default 'open',             -- open|triaged|in_progress|resolved|wont_fix
  linked_ticket_id uuid references tickets(id) on delete set null,
  reporter_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.7 agents ────────────────────────────────────────────────────
create table agents (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  build_scope text not null default 'all',          -- 'all' or a build slug
  status text not null default 'idle',             -- idle|running|ok|error|disabled
  schedule_cron text,
  last_run_at timestamptz,
  last_result text,
  current_task text,
  config jsonb not null default '{}',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.8 agent_runs ────────────────────────────────────────────────
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  trigger text not null,                            -- cron|manual|event
  status text not null default 'running',          -- running|success|error
  input jsonb,
  output jsonb,
  tokens_used int,
  cost_cents int,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on agent_runs(agent_id, started_at desc);

-- ── 5.9 events (THE BUS) ──────────────────────────────────────────
create table events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  build_id uuid references builds(id) on delete set null,
  actor text not null default 'system',            -- 'human:<member>'|'agent:<slug>'|'webhook:<provider>'|'system'
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}',
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on events(processed, created_at);
create index on events(type);

-- ── 5.10 rules (EVENT -> ACTION CONFIG) ───────────────────────────
create table rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger_event text not null,                      -- matches events.type ('*' suffix wildcard)
  build_scope text not null default 'all',
  conditions jsonb not null default '[]',
  actions jsonb not null default '[]',
  requires_approval boolean not null default false,
  is_enabled boolean not null default true,
  priority int not null default 100,                -- lower runs first
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.11 action_log (IMMUTABLE AUDIT) ─────────────────────────────
create table action_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  rule_id uuid references rules(id) on delete set null,
  action_type text not null,
  status text not null,                            -- success|failed|skipped|awaiting_approval|approved|rejected
  actor text not null,
  build_id uuid references builds(id) on delete set null,
  summary text not null,
  before_state jsonb,
  after_state jsonb,
  external_ref text,
  error text,
  cost_cents int,
  created_at timestamptz not null default now()
);
create index on action_log(created_at desc);
create index on action_log(build_id, created_at desc);

-- ── 5.12 approvals (HUMAN-IN-THE-LOOP GATES) ──────────────────────
create table approvals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  rule_id uuid references rules(id) on delete set null,
  action_spec jsonb not null,
  title text not null,
  description text,
  preview jsonb,
  risk text not null default 'medium',             -- low|medium|high
  status text not null default 'pending',          -- pending|approved|rejected|expired
  build_id uuid references builds(id) on delete set null,
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index on approvals(status, created_at);

-- ── 5.13 connections (INTEGRATIONS) ───────────────────────────────
create table connections (
  id uuid primary key default gen_random_uuid(),
  provider text unique not null,                    -- github|stripe|mercury|gmail|anthropic|expo|appstore|google_ads|slack
  status text not null default 'disconnected',      -- connected|pending|disconnected|error
  display_name text not null,
  description text,
  sync_frequency text,
  last_sync_at timestamptz,
  last_sync_status text,                            -- ok|error
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.14 metric_snapshots (TIME SERIES) ───────────────────────────
create table metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,  -- null = portfolio-wide
  metric text not null,
  value_num numeric not null,
  captured_on date not null default current_date,
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);
create unique index on metric_snapshots(coalesce(build_id::text,'portfolio'), metric, captured_on);

-- ── 5.15 milestones ───────────────────────────────────────────────
create table milestones (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete cascade,  -- null = company-wide
  title text not null,
  description text,
  target_date date,
  status text not null default 'open',             -- open|active|done|missed
  unlocks text,
  sort_order int not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 5.16 briefings ────────────────────────────────────────────────
create table briefings (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'daily',              -- daily|weekly|alert
  headline text not null,
  body text not null,
  priorities jsonb not null default '[]',
  generated_for date not null default current_date,
  model text,
  tokens_used int,
  created_at timestamptz not null default now()
);
create index on briefings(generated_for desc);

-- ── 13.2 decisions (premortem/postmortem) ─────────────────────────
create table decisions (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references builds(id) on delete set null,
  kind text not null,                              -- gated_action|milestone|strategic
  ref_type text,                                   -- 'approval'|'milestone'|'agent_run'
  ref_id uuid,
  title text not null,
  context jsonb not null default '{}',
  premortem jsonb,
  premortem_at timestamptz,
  outcome text,                                    -- pending|succeeded|failed|partial|abandoned
  outcome_at timestamptz,
  postmortem jsonb,
  postmortem_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 13.2 learnings ────────────────────────────────────────────────
create table learnings (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references decisions(id) on delete set null,
  build_id uuid references builds(id) on delete set null,
  lesson text not null,
  tags text[] default '{}',
  weight int not null default 1,
  source_outcome text,                             -- failed|succeeded|partial
  created_at timestamptz not null default now()
);
create index on learnings(build_id);

-- ── updated_at triggers on every mutable table ────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'members','builds','tickets','expenses','revenue_entries','prospects',
    'feedback','agents','rules','connections','milestones','decisions'
  ]
  loop
    execute format(
      'create trigger trg_%1$s_updated_at before update on %1$I
         for each row execute function public.set_updated_at();', t);
  end loop;
end $$;
