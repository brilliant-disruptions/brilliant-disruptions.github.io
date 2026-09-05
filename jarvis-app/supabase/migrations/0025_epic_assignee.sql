-- 0025_epic_assignee.sql
-- Epics gain a real assignee, mirroring tickets: whoever drags an epic to a
-- new status becomes its assignee (stamped client-side in EpicsBoard.move()).
alter table epics
  add column assignee_id uuid references members(id) on delete set null;
