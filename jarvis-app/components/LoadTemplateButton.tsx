"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useWorkflowTemplates } from "@/lib/queries/hooks";
import { scopeFilter } from "@/lib/scope";
import { ghostBtn, primaryBtn } from "@/components/Modal";
import type { ItemType } from "@/lib/board-constants";
import type { Tables } from "@/lib/database.types";

type TemplateStageRule = {
  from_stage: string;
  to_stage: string;
  gating_conditions: unknown[];
  checklist_items: string[];
};
type TemplateFieldRequirement = {
  stage_key: string;
  direction: "enter" | "exit";
  field_key: string;
  field_label: string;
};
type TemplateWipGroup = { name: string; stage_keys: string[]; max_count: number; scope: string };
type TemplateStage = { key: string; label: string; is_terminal: boolean; wip_limit: number | null };

function summarize(t: Tables<"workflow_templates">) {
  const stages = (t.stages ?? {}) as Record<string, TemplateStage[]>;
  const rules = (t.stage_rules ?? {}) as Record<string, TemplateStageRule[]>;
  const groups = (t.wip_groups ?? {}) as Record<string, TemplateWipGroup[]>;
  const reqs = (t.field_requirements ?? {}) as Record<string, TemplateFieldRequirement[]>;
  const count = (obj: Record<string, unknown[]>) => Object.values(obj).reduce((n, arr) => n + arr.length, 0);
  return `${count(stages)} stages, ${count(rules)} rules, ${count(groups)} WIP groups, ${count(reqs)} field requirements`;
}

/** Loads a workflow_templates row into the selected scope's own workflow_stages /
 *  workflow_stage_rules / workflow_wip_groups / workflow_field_requirements rows —
 *  a destructive delete-then-insert per item_type covered by the template. */
export function LoadTemplateButton({ buildId }: { buildId: string | null }) {
  const qc = useQueryClient();
  const templates = useWorkflowTemplates();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function load(t: Tables<"workflow_templates">) {
    if (
      !confirm(
        `Load "${t.name}" into ${buildId === null ? "the global config" : "this build"}? This replaces stages, transition rules, WIP groups, and field requirements for any item type covered by the template.`,
      )
    )
      return;
    setLoadingId(t.id);

    const stagesByType = (t.stages ?? {}) as Record<string, TemplateStage[]>;
    for (const itemType of Object.keys(stagesByType) as ItemType[]) {
      const rows = stagesByType[itemType].map((s, i) => ({
        build_id: buildId,
        item_type: itemType,
        key: s.key,
        label: s.label,
        sort_order: i,
        is_terminal: s.is_terminal,
        wip_limit: s.wip_limit,
      }));
      await scopeFilter(supabase.from("workflow_stages").delete().eq("item_type", itemType), buildId);
      if (rows.length > 0) await supabase.from("workflow_stages").insert(rows);
    }

    const rulesByType = (t.stage_rules ?? {}) as Record<string, TemplateStageRule[]>;
    for (const itemType of Object.keys(rulesByType)) {
      const rows = rulesByType[itemType].map((r) => ({
        build_id: buildId,
        item_type: itemType,
        from_stage: r.from_stage,
        to_stage: r.to_stage,
        gating_conditions: r.gating_conditions as never,
        checklist_items: r.checklist_items,
        required_checklist_key: r.checklist_items.length > 0 ? `kill_gate_${r.from_stage}_${r.to_stage}` : null,
      }));
      await scopeFilter(supabase.from("workflow_stage_rules").delete().eq("item_type", itemType), buildId);
      if (rows.length > 0) await supabase.from("workflow_stage_rules").insert(rows);
    }

    const groupsByType = (t.wip_groups ?? {}) as Record<string, TemplateWipGroup[]>;
    for (const itemType of Object.keys(groupsByType)) {
      await scopeFilter(supabase.from("workflow_wip_groups").delete().eq("item_type", itemType), buildId);
      const rows = groupsByType[itemType].map((g) => ({ build_id: buildId, item_type: itemType, ...g }));
      if (rows.length > 0) await supabase.from("workflow_wip_groups").insert(rows);
    }

    const reqsByType = (t.field_requirements ?? {}) as Record<string, TemplateFieldRequirement[]>;
    for (const itemType of Object.keys(reqsByType)) {
      await scopeFilter(supabase.from("workflow_field_requirements").delete().eq("item_type", itemType), buildId);
      const rows = reqsByType[itemType].map((r) => ({ build_id: buildId, item_type: itemType, ...r }));
      if (rows.length > 0) await supabase.from("workflow_field_requirements").insert(rows);
    }

    setLoadingId(null);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["workflow_stages"] });
    qc.invalidateQueries({ queryKey: ["workflow_stage_rules"] });
    qc.invalidateQueries({ queryKey: ["workflow_wip_groups"] });
    qc.invalidateQueries({ queryKey: ["workflow_field_requirements"] });
  }

  async function remove(t: Tables<"workflow_templates">) {
    if (!confirm(`Delete the "${t.name}" template? This can't be undone.`)) return;
    const { error } = await supabase.from("workflow_templates").delete().eq("id", t.id);
    if (!error) qc.invalidateQueries({ queryKey: ["workflow_templates"] });
  }

  return (
    <div className="relative">
      <button className={ghostBtn} onClick={() => setOpen((o) => !o)}>
        Templates ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-96 rounded-md border border-[var(--glass-border-2)] bg-[var(--void-2)] p-2 shadow-lg">
            {(templates.data ?? []).length === 0 && (
              <p className="p-2 text-sm text-[var(--muted-hi)]">No templates yet.</p>
            )}
            {(templates.data ?? []).map((t) => (
              <div key={t.id} className="rounded-md p-2 hover:bg-[var(--glass-border-2)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--white)]">{t.name}</p>
                    <p className="text-xs text-[var(--muted-hi)]">{summarize(t)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      className={ghostBtn + " mb-0 px-2 py-1 text-xs"}
                      onClick={() => setPreviewId((id) => (id === t.id ? null : t.id))}
                    >
                      {previewId === t.id ? "Hide" : "Preview"}
                    </button>
                    <button
                      className={primaryBtn + " px-2 py-1 text-xs"}
                      disabled={loadingId === t.id}
                      onClick={() => load(t)}
                    >
                      {loadingId === t.id ? "Loading…" : "Load"}
                    </button>
                    <button className={ghostBtn + " mb-0 px-2 py-1 text-xs"} onClick={() => remove(t)}>
                      Delete
                    </button>
                  </div>
                </div>
                {previewId === t.id && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-[var(--glass-bg)] p-2 text-[10px] text-[var(--muted-hi)]">
                    {JSON.stringify(
                      { stages: t.stages, wip_groups: t.wip_groups, stage_rules: t.stage_rules, field_requirements: t.field_requirements },
                      null,
                      2,
                    )}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
