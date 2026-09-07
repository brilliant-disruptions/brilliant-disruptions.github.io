"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useTemplates, useWorkflowStageRules, useWorkflowStages } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { inputClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { resolveStages, type CustomField } from "@/lib/board-constants";

const ITEM_TYPES = ["ticket", "epic", "initiative"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

type GatingCondition = { field: string; operator: "==" | "!="; value: unknown };
type EdgeRule = { toStage: string; gatingConditions: GatingCondition[] };

/** Per-build visual editor for allowed stage transitions and the custom-field
 *  conditions required to make them, per item type. No rows for a given
 *  from_stage means that stage is unrestricted — matches advance_ticket's
 *  backward-compatible default in supabase/migrations/0029_workflow_stage_rules.sql. */
export function WorkflowRulesEditor({ buildId }: { buildId: string }) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const rules = useWorkflowStageRules();
  const workflowStages = useWorkflowStages();
  const [itemType, setItemType] = useState<ItemType>("ticket");
  const [saving, setSaving] = useState(false);

  // from_stage -> list of allowed edges (presence of a from_stage key = restricted)
  const [edges, setEdges] = useState<Record<string, EdgeRule[]>>({});

  useEffect(() => {
    const scoped = (rules.data ?? []).filter((r) => r.build_id === buildId && r.item_type === itemType);
    const next: Record<string, EdgeRule[]> = {};
    for (const r of scoped) {
      const list = next[r.from_stage] ?? (next[r.from_stage] = []);
      list.push({ toStage: r.to_stage, gatingConditions: (r.gating_conditions as GatingCondition[]) ?? [] });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncing local edit state from the fetched rows when itemType/buildId/rules change
    setEdges(next);
  }, [itemType, rules.data, buildId]);

  const stages = resolveStages(workflowStages.data, buildId, itemType);
  const template =
    templates.data?.find((t) => t.build_id === buildId && t.item_type === itemType) ??
    templates.data?.find((t) => t.build_id === null && t.item_type === itemType);
  const fields = ((template?.fields as CustomField[] | undefined) ?? []).filter((f) => f.key !== "points");

  function toggleRestricted(fromStage: string, restricted: boolean) {
    setEdges((prev) => {
      const next = { ...prev };
      if (restricted) next[fromStage] = [];
      else delete next[fromStage];
      return next;
    });
  }

  function toggleEdge(fromStage: string, toStage: string, allowed: boolean) {
    setEdges((prev) => {
      const list = prev[fromStage] ?? [];
      const nextList = allowed
        ? [...list, { toStage, gatingConditions: [] }]
        : list.filter((e) => e.toStage !== toStage);
      return { ...prev, [fromStage]: nextList };
    });
  }

  function updateEdgeConditions(fromStage: string, toStage: string, conditions: GatingCondition[]) {
    setEdges((prev) => ({
      ...prev,
      [fromStage]: (prev[fromStage] ?? []).map((e) => (e.toStage === toStage ? { ...e, gatingConditions: conditions } : e)),
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
      })),
    );
    // Small table, one editor screen at a time — replace this build+item_type's rows wholesale
    // rather than diffing, matching EngineeringTemplates' whole-array-write approach.
    await supabase.from("workflow_stage_rules").delete().eq("build_id", buildId).eq("item_type", itemType);
    if (rows.length > 0) await supabase.from("workflow_stage_rules").insert(rows);
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["workflow_stage_rules"] });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Workflow rules</SectionTitle>
        <select
          className={inputClass + " mt-0 w-40"}
          value={itemType}
          onChange={(e) => setItemType(e.target.value as ItemType)}
        >
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

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
                            <GatingConditionsEditor
                              fields={fields}
                              conditions={edge.gatingConditions}
                              onChange={(c) => updateEdgeConditions(from.key, to.key, c)}
                            />
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
    </Card>
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
