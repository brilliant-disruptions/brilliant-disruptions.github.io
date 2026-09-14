-- 0036_remove_workflow_tab.sql
-- Removes the Workflow tab feature (tickets/epics/initiatives Kanban board,
-- gate rules, WIP limits, swimlanes, templates, board filters) and every
-- backend object exclusive to it. Confirmed via grep that nothing outside
-- this feature references these tables/columns/functions.

drop function if exists public.advance_ticket(uuid, text);
drop function if exists public.reassign_initiative_build(uuid, uuid);

alter table tickets drop column if exists epic_id;

drop table if exists board_filters;
drop table if exists workflow_swimlanes;
drop table if exists workflow_field_requirements;
drop table if exists workflow_wip_groups;
drop table if exists workflow_stage_rules;
drop table if exists workflow_stages;
drop table if exists workflow_templates;
drop table if exists work_item_templates;
drop table if exists epics;
drop table if exists initiatives;

alter table tickets
  drop column if exists swimlane,
  drop column if exists sub_status,
  drop column if exists points,
  drop column if exists custom_fields,
  drop column if exists assignee_id,
  drop column if exists pullable,
  drop column if exists key;

drop sequence if exists work_item_key_seq;
