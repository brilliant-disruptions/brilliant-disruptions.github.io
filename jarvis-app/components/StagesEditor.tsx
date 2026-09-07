"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useWorkflowStageRules, useWorkflowStages } from "@/lib/queries/hooks";
import { Card, SectionTitle } from "@/components/ui";
import { inputClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { resolveStages, type ItemType, type StageDef } from "@/lib/board-constants";

const ITEM_TYPES: ItemType[] = ["ticket", "epic", "initiative"];

function slugify(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Per-build editor for the actual stage columns (add/rename/reorder/delete, mark
 *  terminal) plus a read-only flow diagram of the allowed transitions between them.
 *  No workflow_stages rows for a build/item_type means "use the hardcoded app
 *  defaults" (see lib/board-constants.ts resolveStages) — saving here is what
 *  creates a build's first custom rows. */
export function StagesEditor({ buildId }: { buildId: string }) {
  const qc = useQueryClient();
  const workflowStages = useWorkflowStages();
  const rules = useWorkflowStageRules();
  const [itemType, setItemType] = useState<ItemType>("ticket");
  const [stages, setStages] = useState<StageDef[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncing local edit state when itemType/buildId/data changes
    setStages(resolveStages(workflowStages.data, buildId, itemType));
  }, [itemType, buildId, workflowStages.data]);

  const edges = (rules.data ?? []).filter((r) => r.item_type === itemType && (r.build_id === buildId || r.build_id === null));

  function addStage() {
    const label = "New stage";
    let key = slugify(label);
    let i = 2;
    while (stages.some((s) => s.key === key)) key = `${slugify(label)}_${i++}`;
    setStages([...stages, { key, label, is_terminal: false }]);
  }
  function updateLabel(i: number, label: string) {
    setStages(stages.map((s, idx) => (idx === i ? { ...s, label } : s)));
  }
  function toggleTerminal(i: number, is_terminal: boolean) {
    setStages(stages.map((s, idx) => (idx === i ? { ...s, is_terminal } : s)));
  }
  function removeStage(i: number) {
    setStages(stages.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next);
  }

  async function save() {
    setSaving(true);
    const rows = stages.map((s, i) => ({
      build_id: buildId,
      item_type: itemType,
      key: s.key,
      label: s.label,
      sort_order: i,
      is_terminal: s.is_terminal,
    }));
    // Small table, one editor screen at a time — replace this build+item_type's rows
    // wholesale, matching WorkflowRulesEditor.save()'s delete-then-bulk-insert approach.
    await supabase.from("workflow_stages").delete().eq("build_id", buildId).eq("item_type", itemType);
    if (rows.length > 0) await supabase.from("workflow_stages").insert(rows);
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["workflow_stages"] });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Stages</SectionTitle>
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
        Define which stages exist on this board for {itemType}s, in the order they appear as columns. &ldquo;Terminal&rdquo;
        stages count as done — they close out the item and stop cycle-time clocks.
      </p>

      <div className="mt-4 space-y-2">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-[var(--glass-border-2)] p-2">
            <div className="flex flex-col">
              <button className={ghostBtn + " px-1.5 py-0"} onClick={() => move(i, -1)} disabled={i === 0}>
                ▲
              </button>
              <button
                className={ghostBtn + " px-1.5 py-0"}
                onClick={() => move(i, 1)}
                disabled={i === stages.length - 1}
              >
                ▼
              </button>
            </div>
            <input
              className={inputClass + " mt-0 flex-1"}
              value={s.label}
              onChange={(e) => updateLabel(i, e.target.value)}
            />
            <span className="font-mono text-[10px] text-[var(--muted-hi)]">{s.key}</span>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted-hi)]">
              <input type="checkbox" checked={s.is_terminal} onChange={(e) => toggleTerminal(i, e.target.checked)} />
              Terminal
            </label>
            <button className={ghostBtn} onClick={() => removeStage(i)}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-between">
        <button className={ghostBtn} onClick={addStage}>
          + Add stage
        </button>
        <button className={primaryBtn} onClick={save} disabled={saving || stages.length === 0}>
          {saving ? "Saving…" : "Save stages"}
        </button>
      </div>

      <div className="mt-6">
        <SectionTitle>Flow</SectionTitle>
        <div className="mt-2 flex flex-wrap items-center gap-1 overflow-x-auto pb-2">
          {stages.map((s, i) => {
            const outgoing = edges.filter((e) => e.from_stage === s.key);
            const isRestricted = outgoing.length > 0;
            return (
              <div key={s.key} className="flex items-center gap-1">
                <div
                  className={
                    "rounded-md border px-3 py-1.5 text-xs whitespace-nowrap " +
                    (s.is_terminal
                      ? "border-[var(--success)] text-[var(--success)]"
                      : "border-[var(--glass-border-2)] text-[var(--white)]")
                  }
                  title={
                    isRestricted
                      ? `Can advance to: ${outgoing.map((e) => e.to_stage).join(", ")}`
                      : "Unrestricted — can advance to any stage"
                  }
                >
                  {s.label}
                </div>
                {i < stages.length - 1 && (
                  <span className={isRestricted ? "text-[var(--muted-hi)]" : "text-[var(--muted-hi)]/40"}>→</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-[var(--muted-hi)]">
          Faded arrows mean the stage is unrestricted (can advance to any stage). Hover a stage to see its allowed
          transitions — configure them below under transition rules.
        </p>
      </div>
    </Card>
  );
}
