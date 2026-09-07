// "backlog_pullable" is not a real `stage` value — it's a UI-only split of the
// backlog column by the `pullable` flag (see Kanban.tsx's columnItems()), so
// that dragging a ticket in/out of it toggles `pullable` rather than `stage`.
export const TICKET_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "backlog_pullable", label: "Backlog — Pullable" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
] as const;
export const ALL_TICKET_STAGES = ["backlog", "in_progress", "review", "done", "archived"];

export const EPIC_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "later", label: "Later" },
  { key: "next", label: "Next" },
  { key: "now", label: "Now" },
  { key: "done", label: "Done" },
] as const;

export const INITIATIVE_COLUMNS = [
  { key: "proposed", label: "Proposed" },
  { key: "scoping", label: "Scoping" },
  { key: "active", label: "Active" },
  { key: "validating", label: "Validating" },
  { key: "shipped", label: "Shipped" },
] as const;

/** Hardcoded fallback swimlanes — only used when a build has zero
 *  workflow_swimlanes rows (see resolveSwimlanes below). */
const DEFAULT_SWIMLANES = [
  { key: "expedited", label: "Expedited", color: "#EF4444", icon: "⚡" },
  { key: "product", label: "Product", color: "#6366F1", icon: "◆" },
  { key: "defects", label: "Defects", color: "#F59E0B", icon: "▲" },
  { key: "customer", label: "Customer", color: "#10B981", icon: "●" },
  { key: "growth", label: "Growth", color: "#EC4899", icon: "★" },
] as const;

export type SwimlaneDef = { key: string; label: string; color: string; icon: string };

/** Resolves the swimlane list for a build: the build's own workflow_swimlanes
 *  rows win if any exist, else global (build_id null) rows, else the hardcoded
 *  defaults above — mirrors resolveStages()'s fallback semantics. */
export function resolveSwimlanes(
  rows: { build_id: string | null; key: string; label: string; color: string; icon: string; sort_order: number }[] | undefined,
  buildId: string,
): SwimlaneDef[] {
  const own = (rows ?? []).filter((r) => r.build_id === buildId);
  const global = (rows ?? []).filter((r) => r.build_id === null);
  const source = own.length > 0 ? own : global.length > 0 ? global : null;
  if (!source) return DEFAULT_SWIMLANES.map((s) => ({ ...s }));
  return [...source]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({ key: r.key, label: r.label, color: r.color, icon: r.icon }));
}

export type ItemType = "ticket" | "epic" | "initiative";
export type StageDef = { key: string; label: string; is_terminal: boolean; wip_limit: number | null };

export const WORKFLOW_STAGES: Record<ItemType, readonly { key: string; label: string }[]> = {
  ticket: TICKET_COLUMNS.filter((c) => c.key !== "backlog_pullable"),
  epic: EPIC_COLUMNS,
  initiative: INITIATIVE_COLUMNS,
};

const DEFAULT_TERMINAL_KEY = "done";

function defaultStages(itemType: ItemType): StageDef[] {
  return WORKFLOW_STAGES[itemType].map((s) => ({ ...s, is_terminal: s.key === DEFAULT_TERMINAL_KEY, wip_limit: null }));
}

/** Resolves the stage list to render/edit for a build+item_type: a build's own
 *  custom stages win if it has any, else global (build_id null) custom stages,
 *  else the hardcoded defaults above — so a build with no `workflow_stages`
 *  rows behaves exactly as before this feature existed. */
export function resolveStages(
  rows:
    | {
        build_id: string | null;
        item_type: string;
        key: string;
        label: string;
        sort_order: number;
        is_terminal: boolean;
        wip_limit?: number | null;
      }[]
    | undefined,
  buildId: string,
  itemType: ItemType,
): StageDef[] {
  const forType = (rows ?? []).filter((r) => r.item_type === itemType);
  const own = forType.filter((r) => r.build_id === buildId);
  const global = forType.filter((r) => r.build_id === null);
  const source = own.length > 0 ? own : global.length > 0 ? global : null;
  if (!source) return defaultStages(itemType);
  return [...source]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({ key: r.key, label: r.label, is_terminal: r.is_terminal, wip_limit: r.wip_limit ?? null }));
}

export const FIELD_TYPES = ["text", "number", "select", "date", "checkbox"] as const;

export type CustomField = {
  key: string;
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required?: boolean;
  options?: string[];
};
