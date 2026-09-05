-- 0026_work_item_keys.sql
-- Human-readable "BD-####" keys shared across all three work-item types (one
-- global sequence, so keys are unique and monotonically increasing regardless
-- of type) — distinct from tickets.ref, which holds GitHub issue/PR refs.
create sequence work_item_key_seq start with 1;

alter table initiatives add column key text unique;
alter table epics add column key text unique;
alter table tickets add column key text unique;

alter table initiatives alter column key set default ('BD-' || lpad(nextval('work_item_key_seq')::text, 4, '0'));
alter table epics alter column key set default ('BD-' || lpad(nextval('work_item_key_seq')::text, 4, '0'));
alter table tickets alter column key set default ('BD-' || lpad(nextval('work_item_key_seq')::text, 4, '0'));

-- Backfill existing rows (small counts; exact ordering across types doesn't matter).
update initiatives set key = 'BD-' || lpad(nextval('work_item_key_seq')::text, 4, '0') where key is null;
update epics set key = 'BD-' || lpad(nextval('work_item_key_seq')::text, 4, '0') where key is null;
update tickets set key = 'BD-' || lpad(nextval('work_item_key_seq')::text, 4, '0') where key is null;

alter table initiatives alter column key set not null;
alter table epics alter column key set not null;
alter table tickets alter column key set not null;
