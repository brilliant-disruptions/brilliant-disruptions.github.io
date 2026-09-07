import type { Tables } from "@/lib/database.types";

type StageRule = Tables<"workflow_stage_rules">;
type WorkflowStage = Tables<"workflow_stages">;
type WipGroup = Tables<"workflow_wip_groups">;
type FieldRequirement = Tables<"workflow_field_requirements">;
type GatingCondition = { field: string; operator: "==" | "!="; value: unknown };

/** Per-card checklist overrides: a card can add/remove items from a rule's
 *  default kill-gate checklist without touching the shared board rule. The
 *  override, when present, fully replaces the rule's checklist_items for
 *  that card — stored alongside the checked-state under a derived key so
 *  both travel together in custom_fields. */
export function checklistItemsKey(requiredChecklistKey: string): string {
  return `${requiredChecklistKey}__items`;
}

export function effectiveChecklistItems(
  rule: { required_checklist_key: string | null; checklist_items: string[] },
  customFields: Record<string, unknown>,
): string[] {
  if (!rule.required_checklist_key) return rule.checklist_items;
  const override = customFields[checklistItemsKey(rule.required_checklist_key)];
  return Array.isArray(override) ? (override as string[]) : rule.checklist_items;
}

/** Epics and initiatives move via a direct `.update()` (no RPC), so their
 *  workflow_stage_rules are enforced here, client-side, before the write —
 *  unlike tickets, which get the same check server-side in advance_ticket
 *  (supabase/migrations/0031_kanban_config.sql). Mirrors that function's
 *  semantics: no rows for a from_stage means unrestricted. */
export function checkStageGate(
  rules: StageRule[],
  itemType: "epic" | "initiative",
  buildId: string | null,
  fromStage: string,
  toStage: string,
  customFields: Record<string, unknown>,
): { allowed: true } | { allowed: false; reason: string } {
  if (fromStage === toStage) return { allowed: true };
  const scoped = rules.filter(
    (r) => r.item_type === itemType && (r.build_id === buildId || r.build_id === null) && r.from_stage === fromStage,
  );
  if (scoped.length === 0) return { allowed: true };

  const buildSpecific = scoped.find((r) => r.build_id === buildId && r.to_stage === toStage);
  const edge = buildSpecific ?? scoped.find((r) => r.build_id === null && r.to_stage === toStage);
  if (!edge) return { allowed: false, reason: `transition ${fromStage} → ${toStage} is not allowed` };

  const conditions = (edge.gating_conditions as GatingCondition[]) ?? [];
  for (const cond of conditions) {
    const fieldVal = customFields[cond.field];
    const met = cond.operator === "==" ? fieldVal === cond.value : fieldVal !== cond.value;
    if (!met) return { allowed: false, reason: `gating condition not met: ${cond.field} ${cond.operator} ${cond.value}` };
  }

  if (edge.required_checklist_key) {
    const items = effectiveChecklistItems(edge, customFields);
    const state = (customFields[edge.required_checklist_key] as Record<string, boolean> | undefined) ?? {};
    for (const item of items) {
      if (state[item] !== true) return { allowed: false, reason: `kill gate checklist item not completed: ${item}` };
    }
  }

  return { allowed: true };
}

/** Field-requirement movement rules ("field X required to enter/exit stage Y") —
 *  mirrors advance_ticket's field-requirement enforcement for epics/initiatives. */
export function checkFieldRequirements(
  requirements: FieldRequirement[],
  itemType: "epic" | "initiative",
  buildId: string | null,
  fromStage: string,
  toStage: string,
  customFields: Record<string, unknown>,
): { allowed: true } | { allowed: false; reason: string } {
  if (fromStage === toStage) return { allowed: true };
  const scoped = requirements.filter(
    (r) =>
      r.item_type === itemType &&
      (r.build_id === buildId || r.build_id === null) &&
      ((r.direction === "exit" && r.stage_key === fromStage) || (r.direction === "enter" && r.stage_key === toStage)),
  );
  for (const req of scoped) {
    const val = customFields[req.field_key];
    if (val === null || val === undefined || val === "") {
      return { allowed: false, reason: `${req.field_label} is required to ${req.direction} ${req.stage_key}` };
    }
  }
  return { allowed: true };
}

/** Per-stage + aggregate WIP limit enforcement for epics/initiatives, whose
 *  items array is already loaded client-side (unlike tickets, which count via
 *  a fresh query inside advance_ticket). */
export function checkWipLimit(
  stages: WorkflowStage[],
  groups: WipGroup[],
  itemType: "epic" | "initiative",
  buildId: string | null,
  toStage: string,
  fromStage: string,
  currentItems: { status: string; assignee_id?: string | null }[],
  actorId: string | null,
): { allowed: true } | { allowed: false; reason: string } {
  if (fromStage === toStage) return { allowed: true };

  const stageRow =
    stages.find((s) => s.item_type === itemType && s.build_id === buildId && s.key === toStage) ??
    stages.find((s) => s.item_type === itemType && s.build_id === null && s.key === toStage);
  if (stageRow?.wip_limit != null) {
    const count = currentItems.filter((i) => i.status === toStage).length;
    if (count >= stageRow.wip_limit) {
      return { allowed: false, reason: `WIP limit reached for ${toStage}: ${count} (limit ${stageRow.wip_limit})` };
    }
  }

  const scopedGroups = groups.filter(
    (g) => g.item_type === itemType && (g.build_id === buildId || g.build_id === null) && g.stage_keys.includes(toStage),
  );
  for (const g of scopedGroups) {
    const count =
      g.scope === "owner"
        ? currentItems.filter((i) => g.stage_keys.includes(i.status) && i.assignee_id === actorId).length
        : currentItems.filter((i) => g.stage_keys.includes(i.status)).length;
    if (count >= g.max_count) {
      return { allowed: false, reason: `WIP limit reached for group ${g.name}: ${count} (limit ${g.max_count})` };
    }
  }

  return { allowed: true };
}
