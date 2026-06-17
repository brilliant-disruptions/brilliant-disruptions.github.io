-- 0005_seed.sql
-- Build-agnostic seed (Section 17). NO product/repo/build names anywhere.
-- NO product builds are seeded — first run shows an onboarding empty state and
-- founders add builds manually (GitHub discovery is Phase 2).
-- NO member rows / real emails are seeded — founders are onboarded via
-- member_invites at deploy time (see README), then handle_new_user populates members.

-- ── Agent fleet (Section 13) ──────────────────────────────────────
insert into agents (slug, name, description, build_scope, status, schedule_cron) values
  ('prospecting',       'Prospecting',        'Scrape target SMBs matching the ICP in config; dedupe; insert prospects.', 'all', 'idle', '0 9 * * *'),
  ('outreach_drafter',  'Outreach Drafter',   'Draft cold/follow-up emails in the studio outreach voice; create gated gmail drafts.', 'all', 'idle', null),
  ('market_intel',      'Market Intel',       'Scan competitors/news/patents per build; write findings.', 'all', 'idle', '0 8 * * *'),
  ('code_review',       'Code Review',        'Review queued PRs, summarize risk, comment on GitHub.', 'all', 'idle', null),
  ('deploy_agent',      'Deploy Agent',       'When the last launch blocker clears, propose a staging deploy (gated).', 'all', 'idle', null),
  ('financial_modeler', 'Financial Modeler',  'Recompute forecasts, runway, scenarios nightly.', 'all', 'idle', '0 2 * * *'),
  ('feedback_monitor',  'Feedback Monitor',   'Triage incoming feedback, AI-tag sentiment/severity, suggest linked tickets.', 'all', 'idle', '0 */4 * * *'),
  ('idea_scorer',       'Idea Scorer',        'Score product concepts on the First Dollar Framework.', 'all', 'idle', null),
  ('premortem_analyst', 'Premortem Analyst',  'Before a consequential decision: imagine it failed; enumerate failure modes, leading indicators, mitigations.', 'all', 'idle', null),
  ('postmortem_analyst','Postmortem Analyst', 'After an outcome resolves: compare vs prediction, extract durable lessons, suggest rule changes.', 'all', 'idle', null),
  ('briefing',          'Briefing',           'Synthesize overnight changes into one ranked morning briefing; drives the Pulse strip.', 'all', 'idle', '0 6 * * *'),
  ('health_recomputer', 'Health Recomputer',  'Run the health-score formula per build; snapshot.', 'all', 'idle', '0 3 * * *');

-- ── Connections (Section 17 default statuses) ─────────────────────
insert into connections (provider, status, display_name, description, sync_frequency) values
  ('github',     'disconnected', 'GitHub',             'Issues, PRs, deploys; build discovery.',        '5m'),
  ('anthropic',  'disconnected', 'Anthropic (Claude)', 'Powers the AI gateway, agents, command bar.',    'realtime'),
  ('gmail',      'disconnected', 'Gmail',              'Outreach signals + gated draft/send.',           '15m'),
  ('expo',       'disconnected', 'Expo EAS',           'Build + submission status -> deploy events.',     'on_push'),
  ('appstore',   'disconnected', 'App Store Connect',  'Build/review status + customer reviews.',         '6h'),
  ('slack',      'disconnected', 'Slack / Discord',    'Post high-signal events to a channel.',           'realtime'),
  ('stripe',     'pending',      'Stripe',             'Revenue, MRR, first-dollar.',                     '15m'),
  ('mercury',    'pending',      'Mercury / Bank',     'Cash on hand + auto-drafted expenses.',           '4h'),
  ('google_ads', 'disconnected', 'Google Ads',         'Spend/impressions/conversions (Phase 6).',        '1h');

-- ── Company milestones (build-agnostic, generic wording) ──────────
insert into milestones (build_id, title, description, status, unlocks, sort_order) values
  (null, 'First paid dollar (any build)',        'First ever paid revenue across the portfolio.',                 'open', null,                                 0),
  (null, '$3k portfolio MRR',                     'Sustained $3k monthly recurring revenue across all builds.',    'open', 'paid ads budget + second hire',     1),
  (null, 'First agent-generated dollar',          'Revenue closed with zero manual work — an AI agent closes it.', 'open', null,                                 2),
  (null, 'Fully autonomous product pipeline',     'idea -> code -> ship -> revenue with no manual operation.',     'open', null,                                 3);

-- ── Starter rule set (Section 17, rules 1-11) ─────────────────────
insert into rules (name, description, trigger_event, conditions, actions, requires_approval, priority) values
  ('Ticket done cascade',
   'When a ticket reaches done: recompute health, notify, and close the mapped GitHub issue (no-op if unmapped).',
   'ticket.advanced',
   '[{"field":"to_stage","op":"eq","value":"done"}]',
   '[{"type":"health.recompute","params":{}},{"type":"notify.push","params":{"title":"Ticket reached done","severity":"low"}},{"type":"github.close_issue","params":{}}]',
   false, 10),

  ('Blocker cleared -> propose deploy',
   'When a launch-blocker ticket reaches done: check milestone and propose a staging deploy (gated).',
   'ticket.advanced',
   '[{"field":"ticket.is_blocker","op":"eq","value":true},{"field":"to_stage","op":"eq","value":"done"}]',
   '[{"type":"milestone.check","params":{}},{"type":"agent.dispatch","params":{"agent_slug":"deploy_agent"}}]',
   true, 20),

  ('Prospect replied -> draft follow-up',
   'When a prospect replies, dispatch the outreach drafter (draft auto; send gated).',
   'prospect.status_changed',
   '[{"field":"to_status","op":"eq","value":"replied"}]',
   '[{"type":"agent.dispatch","params":{"agent_slug":"outreach_drafter"}}]',
   false, 30),

  ('High-intent prospect',
   'On high intent: notify and set a follow-up next action.',
   'prospect.high_intent',
   '[]',
   '[{"type":"notify.push","params":{"title":"High-intent prospect","severity":"medium"}},{"type":"prospect.set_next_action","params":{"action":"follow up call"}}]',
   false, 40),

  ('First dollar celebration',
   'First ever paid dollar for a build: notify (high), post to Slack, trigger a celebratory briefing.',
   'revenue.first_dollar',
   '[]',
   '[{"type":"notify.push","params":{"title":"First dollar!","severity":"high"}},{"type":"notify.slack","params":{"channel":"wins"}},{"type":"ai.summarize","params":{"store_to":"briefings"}}]',
   false, 50),

  ('Critical feedback',
   'Critical feedback: notify (high) and auto-create a linked critical ticket.',
   'feedback.critical',
   '[]',
   '[{"type":"notify.push","params":{"title":"Critical feedback","severity":"high"}},{"type":"github.create_issue","params":{"priority":"critical"}}]',
   false, 60),

  ('Expense threshold exceeded',
   'Large single expense: notify and dispatch the financial modeler.',
   'expense.threshold_exceeded',
   '[]',
   '[{"type":"notify.push","params":{"title":"Expense over threshold","severity":"medium"}},{"type":"agent.dispatch","params":{"agent_slug":"financial_modeler"}}]',
   false, 70),

  ('Low runway',
   'Projected runway below threshold: notify (high) and post to Slack.',
   'cash.low_runway',
   '[]',
   '[{"type":"notify.push","params":{"title":"Low runway","severity":"high"}},{"type":"notify.slack","params":{"channel":"alerts"}}]',
   false, 80),

  ('Anomaly detected',
   'Metric anomaly: notify (severity-scaled).',
   'anomaly.detected',
   '[]',
   '[{"type":"notify.push","params":{"title":"Anomaly detected","severity":"medium"}}]',
   false, 90),

  ('Decision opened -> premortem',
   'A consequential decision was opened: run the premortem analyst and attach to the approval/milestone.',
   'decision.opened',
   '[]',
   '[{"type":"agent.dispatch","params":{"agent_slug":"premortem_analyst"}}]',
   false, 100),

  ('Decision resolved -> postmortem',
   'A decision resolved: run the postmortem analyst to write durable learnings.',
   'decision.resolved',
   '[]',
   '[{"type":"agent.dispatch","params":{"agent_slug":"postmortem_analyst"}}]',
   false, 110);
