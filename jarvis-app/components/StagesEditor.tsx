"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useWorkflowStageRules, useWorkflowStages, useWorkflowWipGroups } from "@/lib/queries/hooks";
import { Card, SectionTitle } from "@/components/ui";
import { inputClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { resolveStages, type ItemType, type StageDef } from "@/lib/board-constants";
import type { Tables } from "@/lib/database.types";

type WipGroup = Tables<"workflow_wip_groups">;

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
  // Tracks unsaved local edits so a background refetch (realtime CDC on
  // workflow_stages fires on every change, incl. this component's own
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncing local edit state when itemType/buildId/data changes
    setStages(resolveStages(workflowStages.data, buildId, itemType));
  }, [itemType, buildId, workflowStages.data]);

  const edges = (rules.data ?? []).filter((r) => r.item_type === itemType && (r.build_id === buildId || r.build_id === null));

  function addStage() {
    dirtyRef.current = true;
    const label = "New stage";
    let key = slugify(label);
    let i = 2;
    while (stages.some((s) => s.key === key)) key = `${slugify(label)}_${i++}`;
    setStages([...stages, { key, label, is_terminal: false, wip_limit: null }]);
  }
  function updateLabel(i: number, label: string) {
    dirtyRef.current = true;
    setStages(stages.map((s, idx) => (idx === i ? { ...s, label } : s)));
  }
  function toggleTerminal(i: number, is_terminal: boolean) {
    dirtyRef.current = true;
    setStages(stages.map((s, idx) => (idx === i ? { ...s, is_terminal } : s)));
  }
  function updateWipLimit(i: number, raw: string) {
    dirtyRef.current = true;
    const wip_limit = raw.trim() === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    setStages(stages.map((s, idx) => (idx === i ? { ...s, wip_limit } : s)));
  }
  function removeStage(i: number) {
    dirtyRef.current = true;
    setStages(stages.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    dirtyRef.current = true;
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
      wip_limit: s.wip_limit,
    }));
    // Small table, one editor screen at a time — replace this build+item_type's rows
    // wholesale, matching WorkflowRulesEditor.save()'s delete-then-bulk-insert approach.
    await supabase.from("workflow_stages").delete().eq("build_id", buildId).eq("item_type", itemType);
    if (rows.length > 0) await supabase.from("workflow_stages").insert(rows);
    dirtyRef.current = false;
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
              WIP limit
              <input
                type="number"
                min={0}
                placeholder="∞"
                className={inputClass + " mt-0 w-16"}
                value={s.wip_limit ?? ""}
                onChange={(e) => updateWipLimit(i, e.target.value)}
              />
            </label>
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

      <WipGroupsEditor buildId={buildId} itemType={itemType} stages={stages} />
    </Card>
  );
}

/** Aggregate WIP limits spanning multiple stages (e.g. "sum of VALIDATING+
 *  SPECCING+BUILDING <= 1"), which a single per-stage wip_limit can't express. */
function WipGroupsEditor({ buildId, itemType, stages }: { buildId: string; itemType: ItemType; stages: StageDef[] }) {
  const qc = useQueryClient();
  const wipGroups = useWorkflowWipGroups();
  const [saving, setSaving] = useState(false);
  const groups = (wipGroups.data ?? []).filter((g) => g.build_id === buildId && g.item_type === itemType);

  async function addGroup() {
    setSaving(true);
    await supabase.from("workflow_wip_groups").insert({
      build_id: buildId,
      item_type: itemType,
      name: "New WIP group",
      stage_keys: [],
      max_count: 1,
      scope: "board",
    });
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["workflow_wip_groups"] });
  }

  async function updateGroup(id: string, patch: Partial<WipGroup>) {
    await supabase.from("workflow_wip_groups").update(patch).eq("id", id);
    qc.invalidateQueries({ queryKey: ["workflow_wip_groups"] });
  }

  async function removeGroup(id: string) {
    await supabase.from("workflow_wip_groups").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["workflow_wip_groups"] });
  }

  function toggleStageKey(g: { id: string; stage_keys: string[] }, key: string, on: boolean) {
    const next = on ? [...g.stage_keys, key] : g.stage_keys.filter((k) => k !== key);
    updateGroup(g.id, { stage_keys: next });
  }

  return (
    <div className="mt-6">
      <SectionTitle>Aggregate WIP groups</SectionTitle>
      <p className="mt-2 text-xs text-[var(--muted-hi)]">
        Cap the total number of items across several stages combined (e.g. at most 1 item in progress across
        Validating+Speccing+Building), optionally scoped per owner instead of board-wide.
      </p>
      <div className="mt-3 space-y-2">
        {groups.map((g) => (
          <div key={g.id} className="rounded-md border border-[var(--glass-border-2)] p-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                className={inputClass + " mt-0 flex-1"}
                value={g.name}
                onChange={(e) => updateGroup(g.id, { name: e.target.value })}
              />
              <input
                type="number"
                min={0}
                className={inputClass + " mt-0 w-16"}
                value={g.max_count}
                onChange={(e) => updateGroup(g.id, { max_count: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              />
              <select
                className={inputClass + " mt-0 w-24"}
                value={g.scope}
                onChange={(e) => updateGroup(g.id, { scope: e.target.value })}
              >
                <option value="board">board</option>
                <option value="owner">per owner</option>
              </select>
              <button className={ghostBtn + " mb-0"} onClick={() => removeGroup(g.id)}>
                Delete
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {stages.map((s) => (
                <label key={s.key} className="flex items-center gap-1 text-[11px] text-[var(--muted-hi)]">
                  <input
                    type="checkbox"
                    checked={g.stage_keys.includes(s.key)}
                    onChange={(e) => toggleStageKey(g, s.key, e.target.checked)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button className={ghostBtn + " mt-2"} onClick={addGroup} disabled={saving}>
        + Add WIP group
      </button>
    </div>
  );
}
