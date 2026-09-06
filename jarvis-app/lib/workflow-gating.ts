import type { Tables } from "@/lib/database.types";

type StageRule = Tables<"workflow_stage_rules">;
type GatingCondition = { field: string; operator: "==" | "!="; value: unknown };

/** Epics and initiatives move via a direct `.update()` (no RPC), so their
 *  workflow_stage_rules are enforced here, client-side, before the write —
 *  unlike tickets, which get the same check server-side in advance_ticket
 *  (supabase/migrations/0029_workflow_stage_rules.sql). Mirrors that
 *  function's semantics: no rows for a from_stage means unrestricted. */
export function checkStageGate(
  rules: StageRule[],
  itemType: "epic" | "initiative",
  buildId: string,
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
  return { allowed: true };
}
