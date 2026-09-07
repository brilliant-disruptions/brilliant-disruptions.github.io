"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { ghostBtn } from "@/components/Modal";
import type { ItemType } from "@/lib/board-constants";
import template from "@/lib/templates/kanban-playbook-template.json";

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

/** Imports the shipped Operational Playbook seed (lib/templates/kanban-playbook-template.json)
 *  into this build's own workflow_stages / workflow_stage_rules / workflow_wip_groups /
 *  workflow_field_requirements rows. The template's content lives only in that JSON file —
 *  this button is the only place it's read, nothing in it is hardcoded in app logic. */
export function LoadTemplateButton({ buildId }: { buildId: string }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  async function load() {
    if (
      !confirm(
        `Load the "${template.name}" template into this build? This replaces this build's stages, transition rules, WIP groups, and field requirements for any item type covered by the template.`,
      )
    )
      return;
    setLoading(true);

    const stagesByType = template.stages as Record<string, { key: string; label: string; is_terminal: boolean; wip_limit: number | null }[]>;
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
      await supabase.from("workflow_stages").delete().eq("build_id", buildId).eq("item_type", itemType);
      if (rows.length > 0) await supabase.from("workflow_stages").insert(rows);
    }

    const rulesByType = (template.stage_rules ?? {}) as Record<string, TemplateStageRule[]>;
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
      await supabase.from("workflow_stage_rules").delete().eq("build_id", buildId).eq("item_type", itemType);
      if (rows.length > 0) await supabase.from("workflow_stage_rules").insert(rows);
    }

    const groupsByType = (template.wip_groups ?? {}) as Record<string, TemplateWipGroup[]>;
    for (const itemType of Object.keys(groupsByType)) {
      await supabase.from("workflow_wip_groups").delete().eq("build_id", buildId).eq("item_type", itemType);
      const rows = groupsByType[itemType].map((g) => ({ build_id: buildId, item_type: itemType, ...g }));
      if (rows.length > 0) await supabase.from("workflow_wip_groups").insert(rows);
    }

    const reqsByType = (template.field_requirements ?? {}) as Record<string, TemplateFieldRequirement[]>;
    for (const itemType of Object.keys(reqsByType)) {
      await supabase.from("workflow_field_requirements").delete().eq("build_id", buildId).eq("item_type", itemType);
      const rows = reqsByType[itemType].map((r) => ({ build_id: buildId, item_type: itemType, ...r }));
      if (rows.length > 0) await supabase.from("workflow_field_requirements").insert(rows);
    }

    setLoading(false);
    qc.invalidateQueries({ queryKey: ["workflow_stages"] });
    qc.invalidateQueries({ queryKey: ["workflow_stage_rules"] });
    qc.invalidateQueries({ queryKey: ["workflow_wip_groups"] });
    qc.invalidateQueries({ queryKey: ["workflow_field_requirements"] });
  }

  return (
    <button className={ghostBtn} onClick={load} disabled={loading}>
      {loading ? "Loading…" : `Load template: ${template.name}`}
    </button>
  );
}
