"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, useBuilds } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Modal, inputClass, ghostBtn } from "@/components/Modal";
import { Card, SectionTitle, Badge } from "@/components/ui";
import type { Tables } from "@/lib/database.types";

type ItemType = "initiative" | "epic" | "ticket";
type AnyRow = Tables<"initiatives"> | Tables<"epics"> | Tables<"tickets">;

const TABLES: { type: ItemType; table: "initiatives" | "epics" | "tickets"; label: string }[] = [
  { type: "initiative", table: "initiatives", label: "Initiatives" },
  { type: "epic", table: "epics", label: "Epics" },
  { type: "ticket", table: "tickets", label: "Tickets" },
];

/** Every work item, unfiltered by build/status — including rows that are
 *  orphaned from their board (e.g. a status that no configured Kanban column
 *  matches). Lets an admin find and hard-delete rows the boards can't show. */
export function WorkItemsAdmin() {
  const [activeType, setActiveType] = useState<ItemType>("initiative");
  const [selected, setSelected] = useState<{ type: ItemType; row: AnyRow } | null>(null);
  const builds = useBuilds();
  const buildName = useMemo(() => {
    const map = new Map((builds.data ?? []).map((b) => [b.id, b.name]));
    return (id: string | null) => (id === null ? "— No build —" : (map.get(id) ?? id));
  }, [builds.data]);

  return (
    <div className="space-y-4">
      <SectionTitle>All Work Items</SectionTitle>
      <p className="text-xs text-[var(--muted)]">
        Every initiative, epic, and ticket in the database — including items that don&apos;t appear
        on their Kanban board (e.g. a status no configured column matches). View full details or
        permanently delete a row.
      </p>

      <div className="flex gap-1.5 border-b border-[var(--glass-border)]">
        {TABLES.map((t) => (
          <button
            key={t.type}
            onClick={() => setActiveType(t.type)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
              activeType === t.type
                ? "border-[var(--cyan)] text-[var(--white)]"
                : "border-transparent text-[var(--muted-hi)] hover:text-[var(--white)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <WorkItemTable type={activeType} buildName={buildName} onSelect={(row) => setSelected({ type: activeType, row })} />

      {selected && (
        <WorkItemDetailModal
          type={selected.type}
          row={selected.row}
          buildName={buildName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function statusOf(row: AnyRow): string {
  return "stage" in row ? row.stage : row.status;
}

function WorkItemTable({
  type,
  buildName,
  onSelect,
}: {
  type: ItemType;
  buildName: (id: string | null) => string;
  onSelect: (row: AnyRow) => void;
}) {
  const table = TABLES.find((t) => t.type === type)!.table;
  const query = useQuery({
    queryKey: ["settings_all_work_items", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as AnyRow[];
    },
  });

  if (query.isLoading) return <p className="text-xs text-[var(--muted)]">Loading…</p>;
  if (query.error) return <p className="text-xs text-[var(--danger)]">{(query.error as Error).message}</p>;
  const rows = query.data ?? [];
  if (rows.length === 0) return <p className="text-xs text-[var(--muted)]">No {type}s in the database.</p>;

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--glass-border)] text-[10px] uppercase tracking-wide text-[var(--muted-hi)]">
            <th className="px-3 py-2">Key</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Build</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer border-b border-[var(--glass-border)] last:border-0 hover:bg-[var(--glass-border)]/30"
              onClick={() => onSelect(row)}
            >
              <td className="px-3 py-2 font-mono text-xs text-[var(--cyan)]">{row.key}</td>
              <td className="px-3 py-2 text-[var(--white)]">{row.title}</td>
              <td className="px-3 py-2 text-xs text-[var(--muted-hi)]">{buildName(row.build_id)}</td>
              <td className="px-3 py-2">
                <Badge tone="muted">{statusOf(row)}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-[var(--muted)]">
                {new Date(row.created_at).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  className="font-mono text-[10px] text-[var(--muted-hi)] hover:text-[var(--white)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(row);
                  }}
                >
                  view →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function WorkItemDetailModal({
  type,
  row,
  buildName,
  onClose,
}: {
  type: ItemType;
  row: AnyRow;
  buildName: (id: string | null) => string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const table = TABLES.find((t) => t.type === type)!.table;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    setBusy(false);
    if (error) return toast.push(error.message, "error");
    qc.invalidateQueries({ queryKey: ["settings_all_work_items", table] });
    qc.invalidateQueries(); // boards + drawers referencing this row
    toast.push(`Deleted ${row.key}`, "info");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`${row.key} — ${row.title}`}>
      <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-[var(--muted-hi)]">Build</dt>
          <dd className="text-[var(--white)]">{buildName(row.build_id)}</dd>
          <dt className="text-[var(--muted-hi)]">Status</dt>
          <dd className="text-[var(--white)]">{statusOf(row)}</dd>
          <dt className="text-[var(--muted-hi)]">Created</dt>
          <dd className="text-[var(--white)]">{new Date(row.created_at).toLocaleString()}</dd>
          <dt className="text-[var(--muted-hi)]">Updated</dt>
          <dd className="text-[var(--white)]">{new Date(row.updated_at).toLocaleString()}</dd>
        </dl>
        {row.description && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted-hi)]">Description</p>
            <p className="whitespace-pre-wrap text-sm text-[var(--white)]">{row.description}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--muted-hi)]">Raw record</p>
          <pre className="max-h-64 overflow-auto rounded-lg border border-[var(--glass-border)] bg-black/20 p-2 text-[10px] text-[var(--muted-hi)]">
            {JSON.stringify(row, null, 2)}
          </pre>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {!confirmDelete ? (
            <button className="text-xs text-[var(--danger)] hover:underline" onClick={() => setConfirmDelete(true)}>
              Delete {type}…
            </button>
          ) : (
            <span />
          )}
          <button className={ghostBtn} onClick={onClose}>
            Close
          </button>
        </div>

        {confirmDelete && (
          <div className="space-y-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3">
            <p className="text-sm text-[var(--white)]">
              Permanently delete <span className="font-semibold">{row.key}</span>? This cannot be undone.
            </p>
            <input
              className={inputClass}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="type DELETE to confirm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className={ghostBtn}
                onClick={() => {
                  setConfirmDelete(false);
                  setConfirmText("");
                }}
              >
                Keep it
              </button>
              <button
                className="rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                disabled={confirmText !== "DELETE" || busy}
                onClick={del}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
