import type { Tables } from "@/lib/database.types";

type Ticket = Tables<"tickets">;

/** Shape stored in board_filters.config (jsonb). All fields optional/empty = no-op. */
export type BoardFilterConfig = {
  hiddenColumns?: string[];
  swimlanes?: string[];
  assigneeIds?: string[];
  types?: string[];
  priorities?: string[];
  pullableOnly?: boolean;
  withinDays?: number | null;
};

/** True if a ticket satisfies every populated criterion in a single filter. */
export function matchesFilter(ticket: Ticket, config: BoardFilterConfig): boolean {
  if (config.swimlanes?.length && !config.swimlanes.includes(ticket.swimlane)) return false;
  if (config.assigneeIds?.length && !(ticket.assignee_id && config.assigneeIds.includes(ticket.assignee_id)))
    return false;
  if (config.types?.length && !config.types.includes(ticket.type)) return false;
  if (config.priorities?.length && !config.priorities.includes(ticket.priority)) return false;
  if (config.pullableOnly && !ticket.pullable) return false;
  if (config.withinDays) {
    const cutoff = Date.now() - config.withinDays * 24 * 60 * 60 * 1000;
    if (new Date(ticket.created_at).getTime() < cutoff) return false;
  }
  return true;
}

/** Multiple active presets combine with OR semantics on tickets, union on hidden columns. */
export function applyActiveFilters(
  tickets: Ticket[],
  activeConfigs: BoardFilterConfig[],
): { tickets: Ticket[]; hiddenColumns: Set<string> } {
  const hiddenColumns = new Set<string>();
  for (const c of activeConfigs) {
    for (const col of c.hiddenColumns ?? []) hiddenColumns.add(col);
  }
  if (activeConfigs.length === 0) return { tickets, hiddenColumns };
  const filtered = tickets.filter((t) => activeConfigs.some((c) => matchesFilter(t, c)));
  return { tickets: filtered, hiddenColumns };
}
