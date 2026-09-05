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

export const SWIMLANES = [
  { key: "expedited", label: "Expedited", color: "#EF4444", icon: "⚡" },
  { key: "product", label: "Product", color: "#6366F1", icon: "◆" },
  { key: "defects", label: "Defects", color: "#F59E0B", icon: "▲" },
  { key: "customer", label: "Customer", color: "#10B981", icon: "●" },
  { key: "growth", label: "Growth", color: "#EC4899", icon: "★" },
] as const;

export const FIELD_TYPES = ["text", "number", "select", "date", "checkbox"] as const;

export type CustomField = {
  key: string;
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required?: boolean;
  options?: string[];
};
