-- ── workflow_templates: library of loadable stage/rule/WIP/field-requirement
--    playbooks (distinct from work_item_templates, which is custom fields) ──
create table workflow_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  stages jsonb not null default '{}'::jsonb,
  wip_groups jsonb not null default '{}'::jsonb,
  stage_rules jsonb not null default '{}'::jsonb,
  field_requirements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workflow_templates enable row level security;

create policy member_select on workflow_templates for select to authenticated using (public.is_member());
create policy member_write on workflow_templates for all to authenticated
  using (public.is_member()) with check (public.is_member());

create trigger trg_workflow_templates_updated_at before update on workflow_templates
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table workflow_templates;

-- seed with the existing Operational Playbook JSON content
-- (mirrors lib/templates/kanban-playbook-template.json, which stays in place as
-- an inert reference now that this row is the loadable source of truth)
insert into workflow_templates (name, description, stages, wip_groups, stage_rules, field_requirements)
values (
  'Operational Playbook',
  'Seed configuration mirroring the Brilliant Disruptions operational playbook: initiative stages, WIP limits, kill-gate checklists, and field requirements. Loaded into a build''s own workflow_stages / workflow_stage_rules / workflow_wip_groups / workflow_field_requirements rows — nothing here is hardcoded in app code.',
  '{
    "initiative": [
      { "key": "intake", "label": "Intake", "is_terminal": false, "wip_limit": null },
      { "key": "signal_review", "label": "Signal Review", "is_terminal": false, "wip_limit": 3 },
      { "key": "validating", "label": "Validating", "is_terminal": false, "wip_limit": 1 },
      { "key": "specing", "label": "Speccing", "is_terminal": false, "wip_limit": 1 },
      { "key": "building", "label": "Building", "is_terminal": false, "wip_limit": 1 },
      { "key": "internal_review", "label": "Internal Review", "is_terminal": false, "wip_limit": 2 },
      { "key": "beta", "label": "Beta", "is_terminal": false, "wip_limit": 2 },
      { "key": "launch_prep", "label": "Launch Prep", "is_terminal": false, "wip_limit": 1 },
      { "key": "launched", "label": "Launched", "is_terminal": false, "wip_limit": null },
      { "key": "monitoring", "label": "Monitoring", "is_terminal": false, "wip_limit": null },
      { "key": "shipped", "label": "Shipped", "is_terminal": true, "wip_limit": null }
    ]
  }'::jsonb,
  '{
    "initiative": [
      {
        "name": "Active build pipeline",
        "stage_keys": ["validating", "specing", "building"],
        "max_count": 1,
        "scope": "board"
      }
    ]
  }'::jsonb,
  '{
    "initiative": [
      {
        "from_stage": "signal_review",
        "to_stage": "validating",
        "gating_conditions": [],
        "checklist_items": [
          "Signal validated by 3+ customer conversations",
          "Opportunity sized against current roadmap priorities",
          "No unresolved legal/compliance blockers"
        ]
      },
      {
        "from_stage": "validating",
        "to_stage": "specing",
        "gating_conditions": [],
        "checklist_items": [
          "Validation findings documented",
          "Success metrics defined",
          "Stakeholder sign-off recorded"
        ]
      },
      {
        "from_stage": "specing",
        "to_stage": "building",
        "gating_conditions": [],
        "checklist_items": [
          "Spec reviewed by engineering",
          "Scope confirmed as buildable within cycle",
          "Design assets finalized"
        ]
      },
      {
        "from_stage": "building",
        "to_stage": "internal_review",
        "gating_conditions": [],
        "checklist_items": [
          "Feature complete against spec",
          "Automated tests passing",
          "No known critical bugs"
        ]
      },
      {
        "from_stage": "internal_review",
        "to_stage": "beta",
        "gating_conditions": [],
        "checklist_items": [
          "Internal review sign-off",
          "Rollback plan documented"
        ]
      },
      {
        "from_stage": "beta",
        "to_stage": "launch_prep",
        "gating_conditions": [],
        "checklist_items": [
          "Beta feedback reviewed and triaged",
          "No unresolved beta blockers"
        ]
      }
    ]
  }'::jsonb,
  '{
    "initiative": [
      { "stage_key": "shipped", "direction": "enter", "field_key": "launch_notes", "field_label": "Launch notes" },
      { "stage_key": "archived", "direction": "enter", "field_key": "archived_reason", "field_label": "Archive reason" }
    ],
    "epic": [
      { "stage_key": "backlog", "direction": "enter", "field_key": "parent_initiative", "field_label": "Parent initiative" },
      { "stage_key": "archived", "direction": "enter", "field_key": "archived_reason", "field_label": "Archive reason" }
    ],
    "ticket": [
      { "stage_key": "backlog", "direction": "enter", "field_key": "epic_id", "field_label": "Parent epic" },
      { "stage_key": "archived", "direction": "enter", "field_key": "archived_reason", "field_label": "Archive reason" }
    ]
  }'::jsonb
);
