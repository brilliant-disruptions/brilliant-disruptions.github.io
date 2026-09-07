"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  supabase,
  useTemplates,
  useWorkflowFieldRequirements,
  useWorkflowStageRules,
  useWorkflowStages,
} from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { inputClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { resolveStagesForEditor, type CustomField, type ItemType } from "@/lib/board-constants";
import { scopeFilter } from "@/lib/scope";
import type { Tables } from "@/lib/database.types";

type GatingCondition = { field: string; operator: "==" | "!="; value: unknown };
type EdgeRule = {
  toStage: string;
  gatingConditions: GatingCondition[];
  checklistItems: string[];
  requiredChecklistKey: string | null;
};
type FieldRequirement = Tables<"workflow_field_requirements">;

type EffectiveEdge = {
  toStage: string;
  source: "build" | "global";
  checklistCount: number;
  gatingCount: number;
  diverged: boolean;
};

/** Read-only view of which edges resolve from this build's own override vs. the
 *  global rule, mirroring checkStageGate's per-edge (buildSpecific ?? global)
 *  resolution (lib/workflow-gating.ts) — the same semantics the drawers now use. */
function groupRulesByStage(
  allRules: Tables<"workflow_stage_rules">[] | undefined,
  buildId: string,
  itemType: ItemType,
): Record<string, EffectiveEdge[]> {
  const rows = (allRules ?? []).filter((r) => r.item_type === itemType && (r.build_id === buildId || r.build_id === null));
  const result: Record<string, EffectiveEdge[]> = {};
  for (const fromStage of new Set(rows.map((r) => r.from_stage))) {
    const scoped = rows.filter((r) => r.from_stage === fromStage);
    const list: EffectiveEdge[] = [];
    for (const toStage of new Set(scoped.map((r) => r.to_stage))) {
      const buildRow = scoped.find((r) => r.build_id === buildId && r.to_stage === toStage);
      const globalRow = scoped.find((r) => r.build_id === null && r.to_stage === toStage);
      const edge = buildRow ?? globalRow;
      if (!edge) continue;
      const diverged =
        !!buildRow &&
        !!globalRow &&
        (JSON.stringify(buildRow.checklist_items ?? []) !== JSON.stringify(globalRow.checklist_items ?? []) ||
          JSON.stringify(buildRow.gating_conditions ?? []) !== JSON.stringify(globalRow.gating_conditions ?? []));
      list.push({
        toStage,
        source: buildRow ? "build" : "global",
        checklistCount: (edge.checklist_items ?? []).length,
        gatingCount: Array.isArray(edge.gating_conditions) ? (edge.gating_conditions as unknown[]).length : 0,
        diverged,
      });
    }
    result[fromStage] = list;
  }
  return result;
}

/** Per-build visual editor for allowed stage transitions and the custom-field
 *  conditions required to make them, per item type. No rows for a given
 *  from_stage means that stage is unrestricted — matches advance_ticket's
 *  backward-compatible default in supabase/migrations/0029_workflow_stage_rules.sql. */
export function WorkflowRulesEditor({ buildId, itemType }: { buildId: string | null; itemType: ItemType }) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const rules = useWorkflowStageRules();
  const workflowStages = useWorkflowStages();
  const [saving, setSaving] = useState(false);

  // from_stage -> list of allowed edges (presence of a from_stage key = restricted)
  const [edges, setEdges] = useState<Record<string, EdgeRule[]>>({});
  // Tracks unsaved local edits so a background refetch (realtime CDC on
  // workflow_stage_rules fires on every change, incl. this component's own
  // delete+insert during save) doesn't silently overwrite them before Save
  // is clicked. Cleared on successful save and on an intentional tab switch.
  const dirtyRef = useRef(false);
  const scopeKeyRef = useRef<string>("");

  useEffect(() => {
    const scopeKey = `${itemType}:${buildId}`;
    const switchedScope = scopeKeyRef.current !== scopeKey;
    if (dirtyRef.current && !switchedScope) return;
    scopeKeyRef.current = scopeKey;
    dirtyRef.current = false;
    const scoped = (rules.data ?? []).filter((r) => r.build_id === buildId && r.item_type === itemType);
    const next: Record<string, EdgeRule[]> = {};
    for (const r of scoped) {
      const list = next[r.from_stage] ?? (next[r.from_stage] = []);
      list.push({
        toStage: r.to_stage,
        gatingConditions: (r.gating_conditions as GatingCondition[]) ?? [],
        checklistItems: r.checklist_items ?? [],
        requiredChecklistKey: r.required_checklist_key ?? null,
      });
    }
    setEdges(next);
  }, [itemType, rules.data, buildId]);

  const stages = resolveStagesForEditor(workflowStages.data, buildId, itemType);

  // Read-only view of what actually resolves at runtime (checkStageGate's own
  // buildSpecific ?? global logic), independent of the `edges` editable state
  // above — surfaces which edges are build overrides vs inherited from global,
  // and flags overrides that have drifted from the current global content.
  const effectiveByStage = buildId !== null ? groupRulesByStage(rules.data, buildId, itemType) : null;

  const template =
    templates.data?.find((t) => t.build_id === buildId && t.item_type === itemType) ??
    templates.data?.find((t) => t.build_id === null && t.item_type === itemType);
  const fields = ((template?.fields as CustomField[] | undefined) ?? []).filter((f) => f.key !== "points");

  function toggleRestricted(fromStage: string, restricted: boolean) {
    dirtyRef.current = true;
    setEdges((prev) => {
      const next = { ...prev };
      if (restricted) next[fromStage] = [];
      else delete next[fromStage];
      return next;
    });
  }

  function toggleEdge(fromStage: string, toStage: string, allowed: boolean) {
    dirtyRef.current = true;
    setEdges((prev) => {
      const list = prev[fromStage] ?? [];
      const nextList = allowed
        ? [...list, { toStage, gatingConditions: [], checklistItems: [], requiredChecklistKey: null }]
        : list.filter((e) => e.toStage !== toStage);
      return { ...prev, [fromStage]: nextList };
    });
  }

  function updateEdgeConditions(fromStage: string, toStage: string, conditions: GatingCondition[]) {
    dirtyRef.current = true;
    setEdges((prev) => ({
      ...prev,
      [fromStage]: (prev[fromStage] ?? []).map((e) => (e.toStage === toStage ? { ...e, gatingConditions: conditions } : e)),
    }));
  }

  function updateEdgeChecklist(fromStage: string, toStage: string, items: string[]) {
    dirtyRef.current = true;
    setEdges((prev) => ({
      ...prev,
      [fromStage]: (prev[fromStage] ?? []).map((e) =>
        e.toStage === toStage ? { ...e, checklistItems: items, requiredChecklistKey: items.length > 0 ? `kill_gate_${fromStage}_${toStage}` : null } : e,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    const rows = Object.entries(edges).flatMap(([fromStage, list]) =>
      list.map((e) => ({
        build_id: buildId,
        item_type: itemType,
        from_stage: fromStage,
        to_stage: e.toStage,
        gating_conditions: e.gatingConditions as never,
        checklist_items: e.checklistItems,
        required_checklist_key: e.requiredChecklistKey,
      })),
    );
    // Small table, one editor screen at a time — replace this build+item_type's rows wholesale
    // rather than diffing, matching EngineeringTemplates' whole-array-write approach.
    await scopeFilter(supabase.from("workflow_stage_rules").delete(), buildId).eq("item_type", itemType);
    if (rows.length > 0) await supabase.from("workflow_stage_rules").insert(rows);
    dirtyRef.current = false;
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["workflow_stage_rules"] });
  }

  return (
    <Card>
      <SectionTitle>Workflow rules</SectionTitle>

      <p className="mt-2 text-xs text-[var(--muted-hi)]">
        By default any stage can move to any other. Restrict a stage to define exactly which transitions are
        allowed out of it, and optionally require a custom field to be set before a transition is permitted.
      </p>

      <div className="mt-4 space-y-4">
        {stages.map((from) => {
          const restricted = from.key in edges;
          const list = edges[from.key] ?? [];
          return (
            <div key={from.key} className="rounded-md border border-[var(--glass-border-2)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--white)]">{from.label}</span>
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted-hi)]">
                  <input
                    type="checkbox"
                    checked={restricted}
                    onChange={(e) => toggleRestricted(from.key, e.target.checked)}
                  />
                  Restrict transitions
                </label>
              </div>
              {restricted && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {stages
                    .filter((to) => to.key !== from.key)
                    .map((to) => {
                      const edge = list.find((e) => e.toStage === to.key);
                      return (
                        <div key={to.key} className="rounded-md border border-[var(--glass-border-2)] p-2">
                          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-hi)]">
                            <input
                              type="checkbox"
                              checked={!!edge}
                              onChange={(e) => toggleEdge(from.key, to.key, e.target.checked)}
                            />
                            → {to.label}
                          </label>
                          {edge && (
                            <>
                              <GatingConditionsEditor
                                fields={fields}
                                conditions={edge.gatingConditions}
                                onChange={(c) => updateEdgeConditions(from.key, to.key, c)}
                              />
                              <ChecklistEditor
                                items={edge.checklistItems}
                                onChange={(items) => updateEdgeChecklist(from.key, to.key, items)}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {effectiveByStage && (
        <div className="mt-4 rounded-md border border-[var(--glass-border-2)] p-3">
          <p className="text-xs font-medium text-[var(--white)]">Effective at this scope</p>
          <p className="mt-1 text-[10px] text-[var(--muted-hi)]">
            What actually applies to this build right now, per transition — a build-specific override wins over the
            global rule for that exact edge; everything else falls back to global.
          </p>
          {Object.keys(effectiveByStage).length === 0 ? (
            <p className="mt-2 text-[10px] text-[var(--muted-hi)]">No rules apply to this item type, globally or for this build.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {Object.entries(effectiveByStage).map(([fromStage, list]) => (
                <div key={fromStage} className="text-xs">
                  <span className="text-[var(--muted-hi)]">{stages.find((s) => s.key === fromStage)?.label ?? fromStage}:</span>{" "}
                  {list.map((e) => (
                    <span key={e.toStage} className="mr-2 inline-flex items-center gap-1">
                      <span className="text-[var(--white)]">
                        → {stages.find((s) => s.key === e.toStage)?.label ?? e.toStage}
                      </span>
                      <Badge tone={e.source === "build" ? (e.diverged ? "amber" : "cyan") : "muted"}>
                        {e.source === "build" ? (e.diverged ? "override · diverged from global" : "override") : "global"}
                      </Badge>
                      {(e.checklistCount > 0 || e.gatingCount > 0) && (
                        <span className="text-[10px] text-[var(--muted-hi)]">
                          ({e.checklistCount > 0 ? `${e.checklistCount} checklist` : ""}
                          {e.checklistCount > 0 && e.gatingCount > 0 ? ", " : ""}
                          {e.gatingCount > 0 ? `${e.gatingCount} gate` : ""})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {itemType !== "ticket" && (
        <p className="mt-3 text-[10px] text-[var(--muted-hi)]">
          Note: {itemType}s are moved by direct board drag today (no server-side advance function), so these
          rules are enforced in the {itemType} board UI only, not at the database layer.
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button className={primaryBtn} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save workflow rules"}
        </button>
      </div>

      <FieldRequirementsEditor buildId={buildId} itemType={itemType} stages={stages} fields={fields} />
    </Card>
  );
}

/** "Field X required to enter/exit stage Y" movement rules — e.g. archived_reason
 *  required to enter an ARCHIVED stage, actual_hours required to enter DONE. */
function FieldRequirementsEditor({
  buildId,
  itemType,
  stages,
  fields,
}: {
  buildId: string | null;
  itemType: ItemType;
  stages: { key: string; label: string }[];
  fields: CustomField[];
}) {
  const qc = useQueryClient();
  const reqs = useWorkflowFieldRequirements();
  const scoped = (reqs.data ?? []).filter((r) => r.build_id === buildId && r.item_type === itemType);

  async function addRequirement() {
    if (fields.length === 0 || stages.length === 0) return;
    await supabase.from("workflow_field_requirements").insert({
      build_id: buildId,
      item_type: itemType,
      stage_key: stages[0].key,
      direction: "enter",
      field_key: fields[0].key,
      field_label: fields[0].label,
    });
    qc.invalidateQueries({ queryKey: ["workflow_field_requirements"] });
  }

  async function updateRequirement(id: string, patch: Partial<FieldRequirement>) {
    await supabase.from("workflow_field_requirements").update(patch).eq("id", id);
    qc.invalidateQueries({ queryKey: ["workflow_field_requirements"] });
  }

  async function removeRequirement(id: string) {
    await supabase.from("workflow_field_requirements").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["workflow_field_requirements"] });
  }

  return (
    <div className="mt-6 border-t border-[var(--glass-border-2)] pt-4">
      <SectionTitle>Field requirements (movement rules)</SectionTitle>
      <p className="mt-2 text-xs text-[var(--muted-hi)]">
        Require a custom field to be set before an item can enter or exit a stage — e.g. a reason required to
        archive, actual hours required to mark done.
      </p>
      <div className="mt-3 space-y-2">
        {scoped.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-1.5">
            <select
              className={inputClass + " mt-0 w-20"}
              value={r.direction}
              onChange={(e) => updateRequirement(r.id, { direction: e.target.value })}
            >
              <option value="enter">enter</option>
              <option value="exit">exit</option>
            </select>
            <select
              className={inputClass + " mt-0 w-32"}
              value={r.stage_key}
              onChange={(e) => updateRequirement(r.id, { stage_key: e.target.value })}
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-[var(--muted-hi)]">requires</span>
            <select
              className={inputClass + " mt-0 w-32"}
              value={r.field_key}
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                updateRequirement(r.id, { field_key: e.target.value, field_label: f?.label ?? e.target.value });
              }}
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <button className={ghostBtn + " mb-0 px-2 py-1"} onClick={() => removeRequirement(r.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {fields.length === 0 ? (
        <p className="mt-2 text-[10px] text-[var(--muted-hi)]">No custom fields defined to require.</p>
      ) : (
        <button className={ghostBtn + " mt-2 text-[11px]"} onClick={addRequirement}>
          + field requirement
        </button>
      )}
    </div>
  );
}

function ChecklistEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  function addItem() {
    onChange([...items, ""]);
  }
  function updateItem(i: number, text: string) {
    onChange(items.map((it, idx) => (idx === i ? text : it)));
  }
  function removeItem(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  return (
    <div className="mt-2 space-y-1.5 border-t border-[var(--glass-border-2)] pt-2">
      <p className="text-[10px] font-medium text-[var(--muted-hi)]">Kill gate checklist (all items required)</p>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className={inputClass + " mt-0 flex-1"}
            value={item}
            placeholder="Checklist item…"
            onChange={(e) => updateItem(i, e.target.value)}
          />
          <button className={ghostBtn + " mb-0 px-2 py-1"} onClick={() => removeItem(i)}>
            ×
          </button>
        </div>
      ))}
      <button className={ghostBtn + " mb-0 px-2 py-1 text-[11px]"} onClick={addItem}>
        + checklist item
      </button>
    </div>
  );
}

function GatingConditionsEditor({
  fields,
  conditions,
  onChange,
}: {
  fields: CustomField[];
  conditions: GatingCondition[];
  onChange: (c: GatingCondition[]) => void;
}) {
  if (fields.length === 0) {
    return <p className="mt-1.5 text-[10px] text-[var(--muted-hi)]">No custom fields defined to gate on.</p>;
  }

  function addCondition() {
    onChange([...conditions, { field: fields[0].key, operator: "==", value: true }]);
  }
  function updateCondition(i: number, patch: Partial<GatingCondition>) {
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeCondition(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }

  return (
    <div className="mt-2 space-y-1.5">
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.key === c.field);
        return (
          <div key={i} className="flex items-center gap-1.5">
            <select
              className={inputClass + " mt-0 w-28"}
              value={c.field}
              onChange={(e) => {
                const f = fields.find((x) => x.key === e.target.value);
                updateCondition(i, { field: e.target.value, value: f?.type === "checkbox" ? true : "" });
              }}
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              className={inputClass + " mt-0 w-16"}
              value={c.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value as GatingCondition["operator"] })}
            >
              <option value="==">is</option>
              <option value="!=">is not</option>
            </select>
            {field?.type === "checkbox" ? (
              <select
                className={inputClass + " mt-0 w-20"}
                value={String(c.value)}
                onChange={(e) => updateCondition(i, { value: e.target.value === "true" })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : field?.type === "select" ? (
              <select
                className={inputClass + " mt-0 w-28"}
                value={String(c.value)}
                onChange={(e) => updateCondition(i, { value: e.target.value })}
              >
                {(field.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={inputClass + " mt-0 w-24"}
                value={String(c.value ?? "")}
                onChange={(e) => updateCondition(i, { value: e.target.value })}
              />
            )}
            <button className={ghostBtn + " mb-0 px-2 py-1"} onClick={() => removeCondition(i)}>
              ×
            </button>
          </div>
        );
      })}
      <button className={ghostBtn + " mb-0 px-2 py-1 text-[11px]"} onClick={addCondition}>
        + gating condition
      </button>
      {conditions.length === 0 && <Badge tone="muted">unconditional</Badge>}
    </div>
  );
}
