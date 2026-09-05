"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useBoardFilters, useMembers } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { Modal, inputClass, labelClass, primaryBtn, ghostBtn } from "@/components/Modal";
import { TICKET_COLUMNS, SWIMLANES } from "@/lib/board-constants";
import type { BoardFilterConfig } from "@/lib/board-filters";

const TICKET_TYPES = ["bug", "feature", "chore", "spike"];
const PRIORITIES = ["critical", "high", "medium", "low"];

/** Dropdown of saved board filter presets (multi-checkbox) plus a "+ New filter" builder. */
export function BoardFilters() {
  const filters = useBoardFilters();
  const members = useMembers();
  const activeIds = useUIStore((s) => s.activeTicketFilterIds);
  const setActiveIds = useUIStore((s) => s.setActiveTicketFilterIds);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const rows = filters.data ?? [];

  function toggle(id: string) {
    setActiveIds(activeIds.includes(id) ? activeIds.filter((x) => x !== id) : [...activeIds, id]);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-[var(--glass-border-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted-hi)] hover:text-[var(--white)]"
      >
        ▾ Filters{activeIds.length > 0 ? ` (${activeIds.length})` : ""}
      </button>
      {open && (
        <div
          className="absolute right-0 z-40 mt-1.5 w-64 rounded-lg border border-[var(--glass-border)] bg-[var(--elevated)] p-2 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {rows.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-[var(--muted-hi)]">No saved filters yet.</p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {rows.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-[var(--white)] hover:bg-[var(--surface)]/60">
                    <input type="checkbox" checked={activeIds.includes(f.id)} onChange={() => toggle(f.id)} />
                    {f.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            className="mt-2 w-full rounded-md border border-[var(--glass-border-2)] px-2 py-1 text-[11px] text-[var(--muted-hi)] hover:text-[var(--white)]"
            onClick={() => {
              setCreating(true);
              setOpen(false);
            }}
          >
            + New filter
          </button>
        </div>
      )}
      {creating && <CreateFilterModal members={members.data ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateFilterModal({
  members,
  onClose,
}: {
  members: { id: string; full_name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [swimlanes, setSwimlanes] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [pullableOnly, setPullableOnly] = useState(false);
  const [withinDays, setWithinDays] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleIn(list: string[], set: (v: string[]) => void, key: string) {
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  }

  async function submit() {
    if (!name.trim()) return setErr("Name is required.");
    setSaving(true);
    setErr(null);
    const config: BoardFilterConfig = {
      hiddenColumns,
      swimlanes,
      assigneeIds,
      types,
      priorities,
      pullableOnly,
      withinDays: withinDays ? Number(withinDays) : null,
    };
    const { error } = await supabase.from("board_filters").insert({ name: name.trim(), config: config as never });
    setSaving(false);
    if (error) return setErr(error.message);
    qc.invalidateQueries({ queryKey: ["board_filters"] });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="New filter">
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div>
          <label className={labelClass}>Hide columns</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {TICKET_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-1 text-[12px] text-[var(--white)]">
                <input
                  type="checkbox"
                  checked={hiddenColumns.includes(c.key)}
                  onChange={() => toggleIn(hiddenColumns, setHiddenColumns, c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>Swimlanes</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {SWIMLANES.map((s) => (
              <label key={s.key} className="flex items-center gap-1 text-[12px] text-[var(--white)]">
                <input
                  type="checkbox"
                  checked={swimlanes.includes(s.key)}
                  onChange={() => toggleIn(swimlanes, setSwimlanes, s.key)}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>Assigned to</label>
          <div className="mt-1 flex max-h-24 flex-col gap-1 overflow-y-auto">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-1 text-[12px] text-[var(--white)]">
                <input
                  type="checkbox"
                  checked={assigneeIds.includes(m.id)}
                  onChange={() => toggleIn(assigneeIds, setAssigneeIds, m.id)}
                />
                {m.full_name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>Type</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {TICKET_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1 text-[12px] text-[var(--white)]">
                <input type="checkbox" checked={types.includes(t)} onChange={() => toggleIn(types, setTypes, t)} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>Priority</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {PRIORITIES.map((p) => (
              <label key={p} className="flex items-center gap-1 text-[12px] text-[var(--white)]">
                <input
                  type="checkbox"
                  checked={priorities.includes(p)}
                  onChange={() => toggleIn(priorities, setPriorities, p)}
                />
                {p}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-[12px] text-[var(--white)]">
          <input type="checkbox" checked={pullableOnly} onChange={(e) => setPullableOnly(e.target.checked)} />
          Pullable only
        </label>

        <div>
          <label className={labelClass}>Created within last N days</label>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={withinDays}
            onChange={(e) => setWithinDays(e.target.value)}
            placeholder="e.g. 7"
          />
        </div>

        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save filter"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
