"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, useBuilds, useTemplates } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { ghostBtn, inputClass } from "@/components/Modal";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { TicketDrawer } from "@/components/TicketDrawer";
import { EpicDrawer } from "@/components/EpicsBoard";
import { InitiativeDrawer } from "@/components/InitiativesBoard";
import { EngineeringTemplates } from "@/components/EngineeringTemplates";
import type { Tables } from "@/lib/database.types";

type ItemType = "initiative" | "epic" | "ticket";
type AnyRow = Tables<"initiatives"> | Tables<"epics"> | Tables<"tickets">;
type Tab = ItemType | "template";

const TABLES: { type: ItemType; table: "initiatives" | "epics" | "tickets"; label: string }[] = [
  { type: "initiative", table: "initiatives", label: "Initiatives" },
  { type: "epic", table: "epics", label: "Epics" },
  { type: "ticket", table: "tickets", label: "Tickets" },
];
const TABS: { type: Tab; label: string }[] = [...TABLES, { type: "template", label: "Templates" }];

function useAllRows<T>(table: "initiatives" | "epics" | "tickets") {
  return useQuery({
    queryKey: ["settings_all_work_items", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as T[];
    },
  });
}

/** Every work item, unfiltered by build/status — including rows that are
 *  orphaned from their board (e.g. a status that no configured Kanban column
 *  matches). Lets an admin open the real drawer for any item, or hard-delete
 *  a row the boards can't show. Also surfaces every field/checklist template
 *  for viewing, editing, and deletion. */
export function WorkItemsAdmin() {
  const [activeTab, setActiveTab] = useState<Tab>("initiative");
  const [selected, setSelected] = useState<{ type: ItemType; row: AnyRow } | null>(null);
  const builds = useBuilds();
  const templates = useTemplates();
  const initiatives = useAllRows<Tables<"initiatives">>("initiatives");
  const epics = useAllRows<Tables<"epics">>("epics");
  const tickets = useAllRows<Tables<"tickets">>("tickets");
  const buildName = useMemo(() => {
    const map = new Map((builds.data ?? []).map((b) => [b.id, b.name]));
    return (id: string | null) => (id === null ? "— No build —" : (map.get(id) ?? id));
  }, [builds.data]);

  return (
    <div className="space-y-4">
      <SectionTitle>All Work Items</SectionTitle>
      <p className="text-xs text-[var(--muted)]">
        Every initiative, epic, ticket, and field template in the database — including items that
        don&apos;t appear on their Kanban board (e.g. a status no configured column matches). Click a
        key to open the real drawer, or delete a row permanently.
      </p>

      <div className="flex gap-1.5 border-b border-[var(--glass-border)]">
        {TABS.map((t) => (
          <button
            key={t.type}
            onClick={() => setActiveTab(t.type)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
              activeTab === t.type
                ? "border-[var(--cyan)] text-[var(--white)]"
                : "border-transparent text-[var(--muted-hi)] hover:text-[var(--white)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "template" ? (
        <EngineeringTemplates buildId={null} />
      ) : (
        <WorkItemTable
          type={activeTab}
          buildName={buildName}
          onSelect={(row) => setSelected({ type: activeTab, row })}
        />
      )}

      {selected && selected.type === "ticket" && (
        <TicketDrawer ticket={selected.row as Tables<"tickets">} onClose={() => setSelected(null)} />
      )}
      {selected && selected.type === "epic" && (
        <EpicDrawer
          epic={selected.row as Tables<"epics">}
          templates={templates.data ?? []}
          initiatives={initiatives.data ?? []}
          tickets={tickets.data ?? []}
          onClose={() => setSelected(null)}
        />
      )}
      {selected && selected.type === "initiative" && (
        <InitiativeDrawer
          initiative={selected.row as Tables<"initiatives">}
          templates={templates.data ?? []}
          epics={epics.data ?? []}
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
  const query = useAllRows<AnyRow>(table);

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
              className="border-b border-[var(--glass-border)] last:border-0 hover:bg-[var(--glass-border)]/30"
            >
              <td
                className="cursor-pointer px-3 py-2 font-mono text-xs text-[var(--cyan)] hover:underline"
                onClick={() => onSelect(row)}
              >
                {row.key}
              </td>
              <td className="cursor-pointer px-3 py-2 text-[var(--white)]" onClick={() => onSelect(row)}>
                {row.title}
              </td>
              <td className="px-3 py-2 text-xs text-[var(--muted-hi)]">{buildName(row.build_id)}</td>
              <td className="px-3 py-2">
                <Badge tone="muted">{statusOf(row)}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-[var(--muted)]">
                {new Date(row.created_at).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-right">
                <DeleteRowButton type={type} table={table} row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function DeleteRowButton({
  type,
  table,
  row,
}: {
  type: ItemType;
  table: "initiatives" | "epics" | "tickets";
  row: AnyRow;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
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
    setConfirming(false);
    setConfirmText("");
  }

  if (!confirming) {
    return (
      <button
        className="font-mono text-[10px] text-[var(--danger)] hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        delete
      </button>
    );
  }

  return (
    <div
      className="flex items-center justify-end gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        className={inputClass + " mt-0 w-28 py-1 text-[10px]"}
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="type DELETE"
        autoFocus
      />
      <button
        className="rounded bg-[var(--danger)] px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
        disabled={confirmText !== "DELETE" || busy}
        onClick={del}
      >
        {busy ? "…" : `Delete ${type}`}
      </button>
      <button
        className={ghostBtn + " mb-0 px-2 py-1 text-[10px]"}
        onClick={() => {
          setConfirming(false);
          setConfirmText("");
        }}
      >
        Cancel
      </button>
    </div>
  );
}
