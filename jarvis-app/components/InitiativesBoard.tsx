"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  supabase,
  useBuilds,
  useCurrentMember,
  useInitiatives,
  useEpics,
  useTemplates,
  useWorkflowFieldRequirements,
  useWorkflowStageRules,
  useWorkflowStages,
  useWorkflowWipGroups,
} from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { EmptyState, ProgressBar, Lineage, Badge, WorkItemKeyLink, SettingsMenu } from "@/components/ui";
import { useUIStore } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { CreateEpicModal } from "@/components/EpicsBoard";
import { resolveStages } from "@/lib/board-constants";
import {
  checkFieldRequirements,
  checkStageGate,
  checkWipLimit,
  checklistItemsKey,
  effectiveChecklistItems,
} from "@/lib/workflow-gating";
import type { Tables } from "@/lib/database.types";

type Initiative = Tables<"initiatives">;

export function InitiativesBoard({ buildId }: { buildId: string | null | "all" }) {
  const qc = useQueryClient();
  const initiatives = useInitiatives();
  const epics = useEpics();
  const templates = useTemplates();
  const stageRules = useWorkflowStageRules();
  const workflowStages = useWorkflowStages();
  const wipGroups = useWorkflowWipGroups();
  const fieldRequirements = useWorkflowFieldRequirements();
  const me = useCurrentMember();
  const toast = useToast();
  const [selected, setSelected] = useState<Initiative | null>(null);
  const [creating, setCreating] = useState(false);

  const configBuildId = buildId === "all" ? null : buildId;
  const columns = resolveStages(workflowStages.data, configBuildId, "initiative");
  const items = (initiatives.data ?? []).filter((i) => buildId === "all" || i.build_id === buildId);

  const openWorkItem = useUIStore((s) => s.openWorkItem);
  const setOpenWorkItem = useUIStore((s) => s.setOpenWorkItem);
  const setActiveCard = useUIStore((s) => s.setActiveCard);
  useEffect(() => {
    if (openWorkItem?.type !== "initiative") return;
    const i = items.find((x) => x.key === openWorkItem.key);
    if (i) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local drawer selection to an external Zustand signal set by a lineage-link click elsewhere in the tree
      setSelected(i);
      setOpenWorkItem(null);
    }
  }, [openWorkItem, items, setOpenWorkItem]);

  useEffect(() => {
    setActiveCard(selected ? { type: "initiative", key: selected.key } : null);
  }, [selected, setActiveCard]);

  async function move(initiative: Initiative, status: string) {
    const customFields = (initiative.custom_fields as Record<string, unknown>) ?? {};
    const gate = checkStageGate(stageRules.data ?? [], "initiative", initiative.build_id, initiative.status, status, customFields);
    if (!gate.allowed) return toast.push(gate.reason, "error");
    const fieldCheck = checkFieldRequirements(
      fieldRequirements.data ?? [],
      "initiative",
      initiative.build_id,
      initiative.status,
      status,
      customFields,
    );
    if (!fieldCheck.allowed) return toast.push(fieldCheck.reason, "error");
    const wipCheck = checkWipLimit(
      workflowStages.data ?? [],
      wipGroups.data ?? [],
      "initiative",
      initiative.build_id,
      status,
      initiative.status,
      items.map((i) => ({ status: i.status, assignee_id: null })),
      me.data?.id ?? null,
    );
    if (!wipCheck.allowed) return toast.push(wipCheck.reason, "error");
    const { error } = await supabase.from("initiatives").update({ status }).eq("id", initiative.id);
    if (!error) qc.invalidateQueries({ queryKey: ["initiatives"] });
  }

  if (initiatives.isLoading) return null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={primaryBtn} onClick={() => setCreating(true)}>
          + New initiative
        </button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No initiatives" hint="Initiatives group epics behind a company-level bet or outcome." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {columns.map((col) => {
            const colItems = items.filter((i) => i.status === col.key);
            return (
              <div
                key={col.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  const initiative = items.find((x) => x.id === id);
                  if (initiative) move(initiative, col.key);
                }}
                className="flex min-h-[120px] flex-col gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--surface)]/40 p-2"
              >
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-hi)]">
                    {col.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--muted-hi)]">{colItems.length}</span>
                </div>
                {colItems.map((i) => {
                  const children = (epics.data ?? []).filter(
                    (e) => e.initiative_id === i.id && e.status !== "archived",
                  );
                  const done = children.filter((e) => e.status === "done").length;
                  return (
                    <article
                      key={i.id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", i.id)}
                      onClick={() => setSelected(i)}
                      className="cursor-pointer rounded-md border border-[var(--glass-border-2)] bg-[var(--elevated)] p-2.5 hover:border-[var(--indigo)]/50"
                    >
                      <p className="text-sm text-[var(--white)]">
                        <span className="font-mono text-[11px] font-semibold text-[var(--indigo-bright)]">{i.key}</span> {i.title}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Badge tone="muted">{col.label}</Badge>
                        <span className="font-mono text-[10px] text-[var(--muted-hi)]">
                          {done}/{children.length}
                        </span>
                      </div>
                      {children.length > 0 && (
                        <div className="mt-1.5">
                          <ProgressBar value={done} total={children.length} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {selected && (
        <InitiativeDrawer
          key={selected.id}
          initiative={selected}
          onClose={() => setSelected(null)}
          templates={templates.data ?? []}
          epics={epics.data ?? []}
        />
      )}
      {creating && <CreateInitiativeModal buildId={configBuildId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function InitiativeDrawer({
  initiative,
  onClose,
  templates,
  epics,
}: {
  initiative: Initiative;
  onClose: () => void;
  templates: Tables<"work_item_templates">[];
  epics: Tables<"epics">[];
}) {
  const qc = useQueryClient();
  const stageRules = useWorkflowStageRules();
  const builds = useBuilds();
  const [title, setTitle] = useState(initiative.title);
  const [description, setDescription] = useState(initiative.description ?? "");
  const [buildId, setBuildId] = useState(initiative.build_id ?? "");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    (initiative.custom_fields as Record<string, unknown>) ?? {},
  );
  const [creatingEpic, setCreatingEpic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newChecklistItem, setNewChecklistItem] = useState<Record<string, string>>({});

  const children = epics.filter((e) => e.initiative_id === initiative.id);
  const countedChildren = children.filter((e) => e.status !== "archived");
  const doneCount = countedChildren.filter((e) => e.status === "done").length;
  const addableEpics = epics.filter(
    (e) => e.build_id === initiative.build_id && e.initiative_id !== initiative.id && e.status !== "archived",
  );
  const [addingEpicId, setAddingEpicId] = useState("");
  const [linking, setLinking] = useState(false);

  async function addExistingEpic() {
    if (!addingEpicId) return;
    setLinking(true);
    setErr(null);
    const { error } = await supabase.from("epics").update({ initiative_id: initiative.id }).eq("id", addingEpicId);
    setLinking(false);
    if (error) return setErr(error.message);
    setAddingEpicId("");
    qc.invalidateQueries({ queryKey: ["epics"] });
  }

  const trail = [{ key: initiative.key, label: initiative.title, current: true }];

  const template =
    templates.find((t) => t.build_id === initiative.build_id && t.item_type === "initiative") ??
    templates.find((t) => t.build_id === null && t.item_type === "initiative");

  const ownRules = (stageRules.data ?? []).filter((r) => r.build_id === initiative.build_id);
  const rulesSource = ownRules.length > 0 ? ownRules : (stageRules.data ?? []).filter((r) => r.build_id === null);
  const checklistRules = rulesSource.filter(
    (r) => r.item_type === "initiative" && r.from_stage === initiative.status && r.required_checklist_key,
  );

  async function save() {
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("initiatives")
      .update({ title: title.trim(), description: description.trim() || null, custom_fields: customFields as never })
      .eq("id", initiative.id);
    if (error) {
      setSaving(false);
      return setErr(error.message);
    }
    const newBuildId = buildId || null;
    if (newBuildId !== initiative.build_id) {
      const { error: rpcError } = await supabase.rpc("reassign_initiative_build", {
        p_initiative_id: initiative.id,
        p_build_id: newBuildId,
      });
      setSaving(false);
      if (rpcError) return setErr(rpcError.message);
      qc.invalidateQueries({ queryKey: ["epics"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    } else {
      setSaving(false);
    }
    qc.invalidateQueries({ queryKey: ["initiatives"] });
    onClose();
  }

  async function abort() {
    if (!confirm("Abort this initiative? It will be archived and removed from the board.")) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("initiatives").update({ status: "archived" }).eq("id", initiative.id);
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["initiatives"] });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={initiative.title}>
      <div className="space-y-3">
        <Lineage trail={trail} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="muted">{initiative.key}</Badge>
          <div className="ml-auto">
            <SettingsMenu items={[{ label: "Abort", onClick: abort, danger: true }]} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={inputClass + " min-h-[100px] resize-y"}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Build</label>
          <select className={inputClass} value={buildId} onChange={(e) => setBuildId(e.target.value)}>
            <option value="">— No build —</option>
            {(builds.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {template && template.fields && (template.fields as unknown[]).length > 0 && (
          <CustomFieldsEditor fields={template.fields as never} values={customFields} onChange={setCustomFields} />
        )}

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

        <div>
          <div className="flex items-center justify-between">
            <label className={labelClass}>
              Child epics ({doneCount}/{countedChildren.length})
            </label>
            <button
              className="rounded-md border border-[var(--glass-border-2)] px-2 py-1 text-[11px] text-[var(--muted-hi)] hover:text-[var(--white)]"
              onClick={() => setCreatingEpic(true)}
            >
              + New epic
            </button>
          </div>
          {children.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {children.map((e) => (
                <li
                  key={e.id}
                  className={
                    "flex items-center gap-1.5 text-[12px] text-[var(--muted-hi)]" +
                    (e.status === "archived" ? " opacity-60 line-through" : "")
                  }
                >
                  <WorkItemKeyLink itemKey={e.key} type="epic" />
                  <span className="flex-1 truncate">{e.title}</span>
                  <Badge tone="muted">{e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-1.5">
            <select
              className={inputClass + " mt-0 flex-1"}
              value={addingEpicId}
              onChange={(e) => setAddingEpicId(e.target.value)}
            >
              <option value="">— add existing epic —</option>
              {addableEpics.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.key} · {e.title}
                </option>
              ))}
            </select>
            <button
              className="rounded-md border border-[var(--glass-border-2)] px-2 py-1 text-[11px] text-[var(--muted-hi)] hover:text-[var(--white)] disabled:opacity-50"
              onClick={addExistingEpic}
              disabled={!addingEpicId || linking}
            >
              {linking ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

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
      {creatingEpic && (
        <CreateEpicModal
          buildId={initiative.build_id}
          onClose={() => setCreatingEpic(false)}
          initiatives={[initiative]}
          defaultInitiativeId={initiative.id}
        />
      )}
    </Modal>
  );
}

function CreateInitiativeModal({ buildId, onClose }: { buildId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const workflowStages = useWorkflowStages();
  const builds = useBuilds();
  const [title, setTitle] = useState("");
  const [selectedBuildId, setSelectedBuildId] = useState(buildId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) return setErr("Title is required.");
    setSaving(true);
    setErr(null);
    const insertBuildId = selectedBuildId || null;
    const columns = resolveStages(workflowStages.data, insertBuildId, "initiative");
    const status = columns[0]?.key ?? "proposed";
    const { error } = await supabase
      .from("initiatives")
      .insert({ build_id: insertBuildId, title: title.trim(), status });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["initiatives"] });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="New initiative">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelClass}>Build</label>
          <select
            className={inputClass}
            value={selectedBuildId}
            onChange={(e) => setSelectedBuildId(e.target.value)}
          >
            <option value="">— No build —</option>
            {(builds.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create initiative"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
