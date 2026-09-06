-- Link repo_activity rows (commits/PRs) back to a work item by key (BD-####),
-- parsed by the github adapter out of branch names / commit messages / PR
-- titles. Nullable: most activity won't reference a ticket.
alter table repo_activity add column ticket_key text;

create index if not exists repo_activity_ticket_key_idx on repo_activity (ticket_key);
