"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  supabase,
  useMembers,
  useEpics,
  useInitiatives,
  useTemplates,
  useBuilds,
  useLinkedActivity,
  useWorkflowSwimlanes,
  useWorkflowStageRules,
} from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { Badge, Lineage, SettingsMenu, type LineageEntry } from "@/components/ui";
import { resolveSwimlanes } from "@/lib/board-constants";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { checklistItemsKey, effectiveChecklistItems } from "@/lib/workflow-gating";
import type { Tables } from "@/lib/database.types";

const TYPES = ["bug", "feature", "perf", "security", "ux", "infra", "chore"];
const PRIORITIES = ["critical", "high", "medium", "low"];

const PRIORITY_TONE: Record<string, "red" | "amber" | "cyan" | "muted"> = {
  critical: "red",
  high: "amber",
  medium: "cyan",
  low: "muted",
};

/** View + edit a ticket. Stage is read-only here — it advances through the
 *  Kanban (advance_ticket RPC), which also stamps the mover as assignee, so
 *  that's the audited action surface for both. Everything else here is a
 *  direct update (RLS allows members), including a manual assignee override
 *  for assigning work without moving its stage. */
export function TicketDrawer({ ticket, onClose }: { ticket: Tables<"tickets">; onClose: () => void }) {
  const qc = useQueryClient();
  const members = useMembers();
  const epics = useEpics("all");
  const builds = useBuilds();
  const initiatives = useInitiatives();
  const templates = useTemplates();
  const linkedActivity = useLinkedActivity(ticket.key);
  const swimlanesQ = useWorkflowSwimlanes();
  const lanes = resolveSwimlanes(swimlanesQ.data, ticket.build_id);
  const stageRules = useWorkflowStageRules();
  const [description, setDescription] = useState(ticket.description ?? "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [type, setType] = useState(ticket.type ?? "feature");
  const [priority, setPriority] = useState(ticket.priority ?? "medium");
  const [isBlocker, setIsBlocker] = useState(ticket.is_blocker ?? false);
  const [assigneeId, setAssigneeId] = useState(ticket.assignee_id ?? "");
  const [epicId, setEpicId] = useState(ticket.epic_id ?? "");
  const [swimlane, setSwimlane] = useState(ticket.swimlane ?? "product");
  const [points, setPoints] = useState(ticket.points?.toString() ?? "");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    (ticket.custom_fields as Record<string, unknown>) ?? {},
  );
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState<Record<string, string>>({});

  const ownRules = (stageRules.data ?? []).filter((r) => r.build_id === ticket.build_id);
  const rulesSource = ownRules.length > 0 ? ownRules : (stageRules.data ?? []).filter((r) => r.build_id === null);
  const checklistRules = rulesSource.filter(
    (r) => r.item_type === "ticket" && r.from_stage === ticket.stage && r.required_checklist_key,
  );
  const gateRules = rulesSource.filter(
    (r) =>
      r.item_type === "ticket" &&
      r.from_stage === ticket.stage &&
      Array.isArray(r.gating_conditions) &&
      (r.gating_conditions as { field: string; operator?: string; value: unknown }[]).length > 0,
  );

  const template =
    templates.data?.find((t) => t.build_id === ticket.build_id && t.item_type === "ticket") ??
    templates.data?.find((t) => t.build_id === null && t.item_type === "ticket");
  const templateFields = (template?.fields as { key: string }[] | undefined) ?? [];
  const showPoints = templateFields.some((f) => f.key === "points");

  async function save() {
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("tickets")
      .update({
        description: description.trim() || null,
        type,
        priority,
        is_blocker: isBlocker,
        assignee_id: assigneeId || null,
        epic_id: epicId || null,
        swimlane,
        points: points ? Number(points) : null,
        custom_fields: customFields as never,
      })
      .eq("id", ticket.id);
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["tickets"] });
    onClose();
  }

  async function abort() {
    if (!confirm("Abort this ticket? It will be archived and removed from the board.")) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("tickets").update({ stage: "archived" }).eq("id", ticket.id);
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["tickets"] });
    onClose();
  }

  const epic = epics.data?.find((e) => e.id === ticket.epic_id);
  const initiative = initiatives.data?.find((i) => i.id === epic?.initiative_id);
  const trail = [
    initiative && { key: initiative.key, label: initiative.title, type: "initiative" as const },
    epic && { key: epic.key, label: epic.title, type: "epic" as const },
    { key: ticket.key, label: ticket.title, current: true },
  ].filter(Boolean) as LineageEntry[];

  return (
    <Modal open onClose={onClose} title={ticket.title}>
      <div className="space-y-3">
        <Lineage trail={trail} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="muted">{ticket.key}</Badge>
          <Badge tone={PRIORITY_TONE[priority] ?? "muted"}>{priority}</Badge>
          <Badge tone="muted">{ticket.stage}</Badge>
          {ticket.ref && <Badge tone="cyan">{ticket.ref}</Badge>}
          {ticket.external_url && (
            <a
              href={ticket.external_url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-[var(--cyan)] hover:underline"
            >
              GitHub ↗
            </a>
          )}
          <div className="ml-auto">
            <SettingsMenu items={[{ label: "Abort", onClick: abort, danger: true }]} />
          </div>
        </div>

        {(linkedActivity.data?.length ?? 0) > 0 && (
          <div>
            <label className={labelClass}>Linked commits &amp; PRs</label>
            <ul className="space-y-1">
              {linkedActivity.data!.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Badge tone="muted">{a.kind === "pull_request" ? "PR" : "commit"}</Badge>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-[var(--cyan)] hover:underline">
                      {a.ref} {a.title}
                    </a>
                  ) : (
                    <span>
                      {a.ref} {a.title}
                    </span>
                  )}
                  {a.status && <Badge tone="muted">{a.status}</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className={labelClass}>Description</label>
          {editingDescription ? (
            <textarea
              className={inputClass + " min-h-[120px] resize-y"}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => setEditingDescription(false)}
              placeholder="Context, repro steps, acceptance criteria…"
              autoFocus
            />
          ) : (
            <p
              className="min-h-[2.5rem] cursor-text whitespace-pre-wrap rounded-md border border-transparent px-1 py-1.5 text-sm text-[var(--muted-hi)] hover:border-[var(--glass-border-2)]"
              onClick={() => setEditingDescription(true)}
            >
              {description || <span className="text-[var(--muted)]">Click to add a description…</span>}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Priority</label>
            <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Assignee</label>
            <select className={inputClass} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">— unassigned —</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-[var(--muted-hi)]">
              Moving this ticket to a new stage reassigns it to whoever moves it.
            </p>
          </div>
          <div>
            <label className={labelClass}>Swimlane</label>
            <select className={inputClass} value={swimlane} onChange={(e) => setSwimlane(e.target.value)}>
              {lanes.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.icon} {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={showPoints ? "grid grid-cols-2 gap-3" : ""}>
          <div>
            <label className={labelClass}>Epic</label>
            <select className={inputClass} value={epicId} onChange={(e) => setEpicId(e.target.value)}>
              <option value="">— none —</option>
              {(epics.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                  {e.build_id !== ticket.build_id ? ` (${builds.data?.find((b) => b.id === e.build_id)?.name ?? "other build"})` : ""}
                </option>
              ))}
            </select>
          </div>
          {showPoints && (
            <div>
              <label className={labelClass}>Points</label>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
              />
            </div>
          )}
        </div>

        {template && templateFields.filter((f) => f.key !== "points").length > 0 && (
          <CustomFieldsEditor
            fields={templateFields.filter((f) => f.key !== "points") as never}
            values={customFields}
            onChange={setCustomFields}
          />
        )}

        {gateRules.map((rule) => {
          const conditions = rule.gating_conditions as { field: string; operator?: string; value: unknown }[];
          return (
            <div key={rule.id}>
              <label className={labelClass}>
                Transition conditions — {rule.from_stage} → {rule.to_stage} (all required)
              </label>
              <div className="space-y-1">
                {conditions.map((cond, i) => {
                  const fieldVal = customFields[cond.field];
                  const op = cond.operator ?? "==";
                  const met = op === "!=" ? fieldVal !== cond.value : fieldVal === cond.value;
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
                      <span className={met ? "text-[var(--success)]" : "text-[var(--danger)]"}>{met ? "✓" : "✗"}</span>
                      {cond.field} {op} {JSON.stringify(cond.value)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {checklistRules.map((rule) => {
          const key = rule.required_checklist_key as string;
          const itemsKey = checklistItemsKey(key);
          const items = effectiveChecklistItems(rule, customFields);
          const state = (customFields[key] as Record<string, boolean> | undefined) ?? {};
          return (
            <div key={rule.id}>
              <label className={labelClass}>
                Kill gate checklist — {rule.from_stage} → {rule.to_stage} (all required, this card only)
              </label>
              <div className="space-y-1">
                {items.map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={state[item] === true}
                        onChange={(e) =>
                          setCustomFields((prev) => ({
                            ...prev,
                            [key]: { ...state, [item]: e.target.checked },
                          }))
                        }
                      />
                      {item}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const { [item]: _removed, ...restState } = state;
                        setCustomFields((prev) => ({
                          ...prev,
                          [key]: restState,
                          [itemsKey]: items.filter((i) => i !== item),
                        }));
                      }}
                      className="text-[var(--muted-hi)] hover:text-[var(--danger)]"
                      aria-label={`Remove ${item}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex gap-2">
                <input
                  className={inputClass + " flex-1"}
                  placeholder="Add checklist item (this card only)"
                  value={newChecklistItem[rule.id] ?? ""}
                  onChange={(e) => setNewChecklistItem((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const text = (newChecklistItem[rule.id] ?? "").trim();
                    if (!text || items.includes(text)) return;
                    setCustomFields((prev) => ({ ...prev, [itemsKey]: [...items, text] }));
                    setNewChecklistItem((prev) => ({ ...prev, [rule.id]: "" }));
                  }}
                />
              </div>
            </div>
          );
        })}

        <label className="flex items-center gap-2 text-sm text-[var(--muted-hi)]">
          <input type="checkbox" checked={isBlocker} onChange={(e) => setIsBlocker(e.target.checked)} />
          Launch blocker
        </label>

        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
