"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import type { Json } from "@/lib/database.types";

// The rules row plus the Phase 4 config column (not yet in generated types).
export type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  build_scope: string;
  conditions: unknown;
  actions: unknown;
  requires_approval: boolean;
  priority: number;
  is_enabled: boolean;
  config?: { auto_approve_medium?: boolean } | null;
};

const PLACEHOLDER_CONDITIONS = '[{"field":"to_stage","op":"eq","value":"done"}]';
const PLACEHOLDER_ACTIONS = '[{"type":"notify.push","params":{"title":"Hello"}}]';

/** Create or edit a rule via the upsert_rule RPC (no direct client write on the
 *  rules table — §9). Conditions/actions are edited as JSON (the §10.10
 *  power-user surface); we validate before sending so a typo can't persist. */
export function RuleModal({
  open,
  onClose,
  rule,
}: {
  open: boolean;
  onClose: () => void;
  rule: RuleRow | null; // null = create
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger_event ?? "");
  const [buildScope, setBuildScope] = useState(rule?.build_scope ?? "all");
  const [conditions, setConditions] = useState(
    JSON.stringify(rule?.conditions ?? [], null, 0) || "[]",
  );
  const [actions, setActions] = useState(JSON.stringify(rule?.actions ?? [], null, 0) || "[]");
  const [requiresApproval, setRequiresApproval] = useState(rule?.requires_approval ?? false);
  const [autoMedium, setAutoMedium] = useState(rule?.config?.auto_approve_medium ?? false);
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [isEnabled, setIsEnabled] = useState(rule?.is_enabled ?? true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function parseJsonArray(raw: string, label: string): Json[] {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) throw new Error(`${label} must be a JSON array`);
    return v as Json[];
  }

  async function submit() {
    if (!name.trim()) return setErr("Name is required.");
    if (!trigger.trim()) return setErr("Trigger event is required.");
    let conds: Json[];
    let acts: Json[];
    try {
      conds = parseJsonArray(conditions, "Conditions");
      acts = parseJsonArray(actions, "Actions");
    } catch (e) {
      return setErr(String(e instanceof Error ? e.message : e));
    }
    setSaving(true);
    setErr(null);
    const { error } = await supabase.rpc("upsert_rule", {
      p_id: rule?.id ?? null,
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_trigger_event: trigger.trim(),
      p_build_scope: buildScope.trim() || "all",
      p_conditions: conds,
      p_actions: acts,
      p_requires_approval: requiresApproval,
      p_auto_approve_medium: autoMedium,
      p_priority: Number(priority) || 100,
      p_is_enabled: isEnabled,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["rules"] });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={rule ? "Edit rule" : "New rule"}>
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Trigger event</label>
            <input
              className={inputClass}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="ticket.advanced (or ticket.*)"
            />
          </div>
          <div>
            <label className={labelClass}>Build scope</label>
            <input
              className={inputClass}
              value={buildScope}
              onChange={(e) => setBuildScope(e.target.value)}
              placeholder="all (or a build slug)"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Conditions (JSON array)</label>
          <textarea
            className={`${inputClass} h-16 font-mono text-xs`}
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            placeholder={PLACEHOLDER_CONDITIONS}
          />
        </div>
        <div>
          <label className={labelClass}>Actions (JSON array)</label>
          <textarea
            className={`${inputClass} h-16 font-mono text-xs`}
            value={actions}
            onChange={(e) => setActions(e.target.value)}
            placeholder={PLACEHOLDER_ACTIONS}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Priority (lower runs first)</label>
            <input
              type="number"
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col justify-end gap-1.5 pb-1">
            <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
              Requires approval (gate)
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
              <input type="checkbox" checked={autoMedium} onChange={(e) => setAutoMedium(e.target.checked)} />
              Auto-approve medium-risk
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
              <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
              Enabled
            </label>
          </div>
        </div>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : rule ? "Save rule" : "Create rule"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
