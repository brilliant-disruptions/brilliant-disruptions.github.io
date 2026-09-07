"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useWorkflowSwimlanes } from "@/lib/queries/hooks";
import { Card, SectionTitle } from "@/components/ui";
import { inputClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { resolveSwimlanes, type SwimlaneDef } from "@/lib/board-constants";

function slugify(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Per-build editor for swimlanes (the horizontal groupings shown on ticket
 *  boards). No workflow_swimlanes rows for a build means "use the hardcoded
 *  app defaults" (see lib/board-constants.ts resolveSwimlanes). */
export function SwimlanesEditor({ buildId }: { buildId: string }) {
  const qc = useQueryClient();
  const swimlanesQ = useWorkflowSwimlanes();
  const [lanes, setLanes] = useState<SwimlaneDef[]>([]);
  const [saving, setSaving] = useState(false);
  // Tracks unsaved local edits so a background refetch (realtime CDC on
  // workflow_swimlanes fires on every change, incl. this component's own
  // delete+insert during save) doesn't silently overwrite them before Save
  // is clicked. Cleared on successful save and on an intentional build switch.
  const dirtyRef = useRef(false);
  const scopeKeyRef = useRef<string>("");

  useEffect(() => {
    const switchedScope = scopeKeyRef.current !== buildId;
    if (dirtyRef.current && !switchedScope) return;
    scopeKeyRef.current = buildId;
    dirtyRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncing local edit state when buildId/data changes
    setLanes(resolveSwimlanes(swimlanesQ.data, buildId));
  }, [buildId, swimlanesQ.data]);

  function addLane() {
    dirtyRef.current = true;
    const label = "New swimlane";
    let key = slugify(label);
    let i = 2;
    while (lanes.some((l) => l.key === key)) key = `${slugify(label)}_${i++}`;
    setLanes([...lanes, { key, label, color: "#6366F1", icon: "●" }]);
  }
  function update(i: number, patch: Partial<SwimlaneDef>) {
    dirtyRef.current = true;
    setLanes(lanes.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLane(i: number) {
    dirtyRef.current = true;
    setLanes(lanes.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lanes.length) return;
    dirtyRef.current = true;
    const next = [...lanes];
    [next[i], next[j]] = [next[j], next[i]];
    setLanes(next);
  }

  async function save() {
    setSaving(true);
    const rows = lanes.map((l, i) => ({
      build_id: buildId,
      key: l.key,
      label: l.label,
      color: l.color,
      icon: l.icon,
      sort_order: i,
    }));
    await supabase.from("workflow_swimlanes").delete().eq("build_id", buildId);
    if (rows.length > 0) await supabase.from("workflow_swimlanes").insert(rows);
    dirtyRef.current = false;
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["workflow_swimlanes"] });
  }

  return (
    <Card>
      <SectionTitle>Swimlanes</SectionTitle>
      <p className="mt-2 text-xs text-[var(--muted-hi)]">
        Horizontal groupings shown on ticket boards, in display order.
      </p>
      <div className="mt-4 space-y-2">
        {lanes.map((l, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-[var(--glass-border-2)] p-2">
            <div className="flex flex-col">
              <button className={ghostBtn + " px-1.5 py-0"} onClick={() => move(i, -1)} disabled={i === 0}>
                ▲
              </button>
              <button className={ghostBtn + " px-1.5 py-0"} onClick={() => move(i, 1)} disabled={i === lanes.length - 1}>
                ▼
              </button>
            </div>
            <input
              className={inputClass + " mt-0 w-16 text-center"}
              value={l.icon}
              onChange={(e) => update(i, { icon: e.target.value })}
            />
            <input
              className={inputClass + " mt-0 flex-1"}
              value={l.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <span className="font-mono text-[10px] text-[var(--muted-hi)]">{l.key}</span>
            <input
              type="color"
              className="h-7 w-9 rounded border border-[var(--glass-border-2)] bg-transparent"
              value={l.color}
              onChange={(e) => update(i, { color: e.target.value })}
            />
            <button className={ghostBtn} onClick={() => removeLane(i)}>
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between">
        <button className={ghostBtn} onClick={addLane}>
          + Add swimlane
        </button>
        <button className={primaryBtn} onClick={save} disabled={saving || lanes.length === 0}>
          {saving ? "Saving…" : "Save swimlanes"}
        </button>
      </div>
    </Card>
  );
}
