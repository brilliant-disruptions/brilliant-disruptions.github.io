"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  supabase,
  useBuilds,
  useCurrentMember,
  useEpics,
  useInitiatives,
  useMembers,
  useTemplates,
  useTickets,
} from "@/lib/queries/hooks";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { EmptyState, ProgressBar, Avatar, Lineage, Badge, WorkItemKeyLink, type LineageEntry } from "@/components/ui";
import { useUIStore } from "@/lib/store";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { NewIssueModal } from "@/components/NewIssueModal";
import { EPIC_COLUMNS, SWIMLANES } from "@/lib/board-constants";
import type { Tables } from "@/lib/database.types";

type Epic = Tables<"epics">;

export function EpicsBoard({ buildId }: { buildId: string }) {
  const qc = useQueryClient();
  const epics = useEpics();
  const initiatives = useInitiatives();
  const tickets = useTickets();
  const templates = useTemplates();
  const members = useMembers();
  const me = useCurrentMember();
  const [selected, setSelected] = useState<Epic | null>(null);
  const [creating, setCreating] = useState(false);

  const items = (epics.data ?? []).filter((e) => e.build_id === buildId);
  const initiativeById = useMemo(
    () => new Map((initiatives.data ?? []).map((i) => [i.id, i])),
    [initiatives.data],
  );
  const memberById = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m])), [members.data]);

  const openWorkItem = useUIStore((s) => s.openWorkItem);
  const setOpenWorkItem = useUIStore((s) => s.setOpenWorkItem);
  const setActiveCard = useUIStore((s) => s.setActiveCard);
  useEffect(() => {
    if (openWorkItem?.type !== "epic") return;
    const e = items.find((x) => x.key === openWorkItem.key);
    if (e) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local drawer selection to an external Zustand signal set by a lineage-link click elsewhere in the tree
      setSelected(e);
      setOpenWorkItem(null);
    }
  }, [openWorkItem, items, setOpenWorkItem]);

  useEffect(() => {
    setActiveCard(selected ? { type: "epic", key: selected.key } : null);
  }, [selected, setActiveCard]);

  // Dragging an epic to a new status also assigns it to whoever moved it,
  // mirroring advance_ticket's behavior for tickets.
  async function move(epic: Epic, status: string) {
    const { error } = await supabase
      .from("epics")
      .update({ status, assignee_id: me.data?.id ?? epic.assignee_id })
      .eq("id", epic.id);
    if (!error) qc.invalidateQueries({ queryKey: ["epics"] });
  }

  if (epics.isLoading) return null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={primaryBtn} onClick={() => setCreating(true)}>
          + New epic
        </button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No epics" hint="Group related tickets into an epic to track progress toward a bigger outcome." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {EPIC_COLUMNS.map((col) => {
            const colItems = items.filter((e) => e.status === col.key);
            return (
              <div
                key={col.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  const epic = items.find((x) => x.id === id);
                  if (epic) move(epic, col.key);
                }}
                className="flex min-h-[120px] flex-col gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--surface)]/40 p-2"
              >
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-hi)]">
                    {col.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--muted-hi)]">{colItems.length}</span>
                </div>
                {colItems.map((e) => {
                  const lane = SWIMLANES.find((l) => l.key === e.swimlane);
                  const children = (tickets.data ?? []).filter(
                    (t) => t.epic_id === e.id && t.stage !== "archived",
                  );
                  const done = children.filter((t) => t.stage === "done").length;
                  return (
                    <article
                      key={e.id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)}
                      onClick={() => setSelected(e)}
                      style={{ borderLeftColor: lane?.color ?? "var(--glass-border-2)" }}
                      className="cursor-pointer rounded-md border border-l-[3px] border-[var(--glass-border-2)] bg-[var(--elevated)] p-2.5 hover:border-[var(--indigo)]/50"
                    >
                      <div className="flex items-center gap-1.5">
                        {lane && <span style={{ color: lane.color }}>{lane.icon}</span>}
                        <span className="font-mono text-[11px] font-semibold text-[var(--indigo-bright)]">{e.key}</span>
                        <p className="flex-1 text-sm text-[var(--white)]">{e.title}</p>
                        <Avatar
                          name={e.assignee_id ? (memberById.get(e.assignee_id)?.full_name ?? null) : null}
                          color={e.assignee_id ? memberById.get(e.assignee_id)?.avatar_color : null}
                        />
                      </div>
                      {initiativeById.get(e.initiative_id ?? "") && (
                        <p className="mt-0.5 truncate text-[11px] text-[var(--muted-hi)]">
                          ↳ {initiativeById.get(e.initiative_id ?? "")?.title}
                        </p>
                      )}
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
        <EpicDrawer
          key={selected.id}
          epic={selected}
          onClose={() => setSelected(null)}
          templates={templates.data ?? []}
          initiatives={initiatives.data ?? []}
          tickets={tickets.data ?? []}
        />
      )}
      {creating && (
        <CreateEpicModal buildId={buildId} onClose={() => setCreating(false)} initiatives={initiatives.data ?? []} />
      )}
    </div>
  );
}

function EpicDrawer({
  epic,
  onClose,
  templates,
  initiatives: initiativesList,
  tickets,
}: {
  epic: Epic;
  onClose: () => void;
  templates: Tables<"work_item_templates">[];
  initiatives: Tables<"initiatives">[];
  tickets: Tables<"tickets">[];
}) {
  const qc = useQueryClient();
  const builds = useBuilds();
  const initiatives = { data: initiativesList };
  const [title, setTitle] = useState(epic.title);
  const [description, setDescription] = useState(epic.description ?? "");
  const [swimlane, setSwimlane] = useState(epic.swimlane);
  const [initiativeId, setInitiativeId] = useState(epic.initiative_id ?? "");
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    (epic.custom_fields as Record<string, unknown>) ?? {},
  );
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initiative = initiativesList.find((i) => i.id === epic.initiative_id);
  const children = tickets.filter((t) => t.epic_id === epic.id);
  const countedChildren = children.filter((t) => t.stage !== "archived");
  const doneCount = countedChildren.filter((t) => t.stage === "done").length;
  const addableTickets = tickets.filter(
    (t) => t.build_id === epic.build_id && t.epic_id !== epic.id && t.stage !== "archived",
  );
  const [addingTicketId, setAddingTicketId] = useState("");
  const [linking, setLinking] = useState(false);

  async function addExistingTicket() {
    if (!addingTicketId) return;
    setLinking(true);
    setErr(null);
    const { error } = await supabase.from("tickets").update({ epic_id: epic.id }).eq("id", addingTicketId);
    setLinking(false);
    if (error) return setErr(error.message);
    setAddingTicketId("");
    qc.invalidateQueries({ queryKey: ["tickets"] });
  }

  const trail = [
    initiative && { key: initiative.key, label: initiative.title, type: "initiative" as const },
    { key: epic.key, label: epic.title, current: true },
  ].filter(Boolean) as LineageEntry[];

  const template =
    templates.find((t) => t.build_id === epic.build_id && t.item_type === "epic") ??
    templates.find((t) => t.build_id === null && t.item_type === "epic");

  async function save() {
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("epics")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        swimlane,
        initiative_id: initiativeId || null,
        custom_fields: customFields as never,
      })
      .eq("id", epic.id);
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["epics"] });
    onClose();
  }

  async function abort() {
    if (!confirm("Abort this epic? It will be archived and removed from the board.")) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("epics").update({ status: "archived" }).eq("id", epic.id);
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["epics"] });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={epic.title}>
      <div className="space-y-3">
        <Lineage trail={trail} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="muted">{epic.key}</Badge>
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Swimlane</label>
            <select className={inputClass} value={swimlane} onChange={(e) => setSwimlane(e.target.value)}>
              {SWIMLANES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.icon} {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Initiative</label>
            <select className={inputClass} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
              <option value="">— none —</option>
              {(initiatives.data ?? [])
                .filter((i) => i.build_id === epic.build_id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
            </select>
          </div>
        </div>
        {template && template.fields && (template.fields as unknown[]).length > 0 && (
          <CustomFieldsEditor fields={template.fields as never} values={customFields} onChange={setCustomFields} />
        )}

        <div>
          <div className="flex items-center justify-between">
            <label className={labelClass}>
              Child tickets ({doneCount}/{countedChildren.length})
            </label>
            <button
              className="rounded-md border border-[var(--glass-border-2)] px-2 py-1 text-[11px] text-[var(--muted-hi)] hover:text-[var(--white)]"
              onClick={() => setCreatingTicket(true)}
            >
              + New ticket
            </button>
          </div>
          {children.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {children.map((t) => (
                <li
                  key={t.id}
                  className={
                    "flex items-center gap-1.5 text-[12px] text-[var(--muted-hi)]" +
                    (t.stage === "archived" ? " opacity-60 line-through" : "")
                  }
                >
                  <WorkItemKeyLink itemKey={t.key} type="ticket" />
                  <span className="flex-1 truncate">{t.title}</span>
                  <Badge tone="muted">{t.stage}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-1.5">
            <select
              className={inputClass + " mt-0 flex-1"}
              value={addingTicketId}
              onChange={(e) => setAddingTicketId(e.target.value)}
            >
              <option value="">— add existing ticket —</option>
              {addableTickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.key} · {t.title}
                </option>
              ))}
            </select>
            <button
              className="rounded-md border border-[var(--glass-border-2)] px-2 py-1 text-[11px] text-[var(--muted-hi)] hover:text-[var(--white)] disabled:opacity-50"
              onClick={addExistingTicket}
              disabled={!addingTicketId || linking}
            >
              {linking ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            className="mr-auto rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10"
            onClick={abort}
            disabled={saving}
          >
            Abort
          </button>
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {creatingTicket && (
        <NewIssueModal
          open
          onClose={() => setCreatingTicket(false)}
          builds={builds.data ?? []}
          defaultBuild={epic.build_id}
          defaultEpicId={epic.id}
        />
      )}
    </Modal>
  );
}

export function CreateEpicModal({
  buildId,
  onClose,
  initiatives,
  defaultInitiativeId,
}: {
  buildId: string;
  onClose: () => void;
  initiatives: Tables<"initiatives">[];
  defaultInitiativeId?: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [swimlane, setSwimlane] = useState("product");
  const [initiativeId, setInitiativeId] = useState(defaultInitiativeId ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) return setErr("Title is required.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("epics").insert({
      build_id: buildId,
      title: title.trim(),
      swimlane,
      initiative_id: initiativeId || null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["epics"] });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="New epic">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Title</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Swimlane</label>
            <select className={inputClass} value={swimlane} onChange={(e) => setSwimlane(e.target.value)}>
              {SWIMLANES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.icon} {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Initiative</label>
            <select className={inputClass} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
              <option value="">— none —</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create epic"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
