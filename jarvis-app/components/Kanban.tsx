"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, useEpics, useCurrentMember, useBoardFilters, useWorkflowStages, useWorkflowSwimlanes } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Badge, Tag, Avatar } from "@/components/ui";
import { TicketDrawer } from "@/components/TicketDrawer";
import { BoardFilters } from "@/components/BoardFilters";
import { useUIStore } from "@/lib/store";
import { applyActiveFilters, type BoardFilterConfig } from "@/lib/board-filters";
import { resolveStages, resolveSwimlanes, type StageDef, type SwimlaneDef } from "@/lib/board-constants";
import type { Tables } from "@/lib/database.types";

type Ticket = Tables<"tickets">;
type Member = Tables<"members">;
type Epic = Tables<"epics">;
type MoveFn = (ticket: Ticket, toColumn: string) => void;
type TogglePullableFn = (ticket: Ticket) => void;

/** "backlog_pullable" is a UI-only column key, not a real stage — see board-constants.ts.
 *  Pullable tickets float to the top of whichever column they're in. */
function itemsForColumn(items: Ticket[], columnKey: string): Ticket[] {
  let col: Ticket[];
  if (columnKey === "backlog") col = items.filter((t) => t.stage === "backlog" && !t.pullable);
  else if (columnKey === "backlog_pullable") col = items.filter((t) => t.stage === "backlog" && t.pullable);
  else col = items.filter((t) => t.stage === columnKey);
  return [...col].sort((a, b) => Number(b.pullable) - Number(a.pullable));
}

const PRIORITY_TONE: Record<string, "red" | "amber" | "cyan" | "muted"> = {
  critical: "red",
  high: "amber",
  medium: "cyan",
  low: "muted",
};

function TicketCard({
  ticket,
  assignee,
  epic,
  acting,
  move,
  togglePullable,
  onOpen,
  allStages,
  lanes,
}: {
  ticket: Ticket;
  assignee: Member | null;
  epic: Epic | null;
  acting: boolean;
  move: MoveFn;
  togglePullable: TogglePullableFn;
  onOpen: () => void;
  allStages: string[];
  lanes: SwimlaneDef[];
}) {
  const lane = lanes.find((l) => l.key === ticket.swimlane);
  return (
    <article
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", ticket.id)}
      onClick={onOpen}
      style={{ borderLeftColor: lane?.color ?? "var(--glass-border-2)" }}
      className={
        "group cursor-pointer rounded-md border border-l-[3px] border-[var(--glass-border-2)] bg-[var(--elevated)] p-2.5 hover:border-[var(--indigo)]/50 active:cursor-grabbing" +
        (ticket.pullable ? " outline outline-2 outline-offset-1 outline-[var(--pullable)]" : "")
      }
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-[var(--indigo-bright)]">{ticket.key}</span>
        <Badge tone={PRIORITY_TONE[ticket.priority] ?? "muted"}>{ticket.priority}</Badge>
        {ticket.is_blocker && <Badge tone="red">blocker</Badge>}
        {acting && <span className="font-mono text-[10px] text-[var(--indigo-bright)]">⚡ acting…</span>}
        <Avatar name={assignee?.full_name} color={assignee?.avatar_color} />
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          togglePullable(ticket);
        }}
        className={
          "mt-1.5 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium " +
          (ticket.pullable
            ? "border-[var(--pullable)]/50 bg-[var(--pullable)]/10 text-[var(--pullable)]"
            : "border-[var(--glass-border-2)] text-[var(--muted-hi)] hover:text-[var(--white)]")
        }
      >
        ↳ {ticket.pullable ? "Pullable" : "Mark pullable"}
      </button>
      <p className="mt-1.5 text-sm text-[var(--white)]">{ticket.title}</p>
      {epic && <p className="mt-0.5 truncate text-[11px] text-[var(--muted-hi)]">↳ {epic.title}</p>}
      <div className="mt-1.5 flex items-center gap-1.5">
        {ticket.ref && <Tag>{ticket.ref}</Tag>}
        <Tag>{ticket.type}</Tag>
        {ticket.points != null && <Tag>{ticket.points}pt</Tag>}
        {/* Keyboard / no-drag fallback (accessibility, spec §10.6) */}
        <select
          aria-label={`Move ${ticket.title} to another stage`}
          value={ticket.stage}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => move(ticket, e.target.value)}
          className="ml-auto rounded border border-[var(--glass-border-2)] bg-[var(--void-2)] px-1 py-0.5 font-mono text-[10px] text-[var(--muted-hi)]"
        >
          {allStages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function ColumnsGrid({
  items,
  allTickets,
  acting,
  memberById,
  epicById,
  move,
  togglePullable,
  onOpen,
  hiddenColumns,
  columns,
  allStages,
  lanes,
}: {
  items: Ticket[];
  allTickets: Ticket[];
  acting: Set<string>;
  memberById: Map<string, Member>;
  epicById: Map<string, Epic>;
  move: MoveFn;
  togglePullable: TogglePullableFn;
  onOpen: (t: Ticket) => void;
  hiddenColumns: Set<string>;
  columns: { key: string; label: string }[];
  allStages: string[];
  lanes: SwimlaneDef[];
}) {
  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.key));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {visibleColumns.map((col) => {
        const colItems = itemsForColumn(items, col.key);
        return (
          <div
            key={col.key}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/plain");
              const t = allTickets.find((x) => x.id === id);
              if (t) move(t, col.key);
            }}
            className="flex min-h-[120px] flex-col gap-2 rounded-lg border border-[var(--glass-border)] bg-[var(--surface)]/40 p-2"
          >
            <div className="flex items-center justify-between px-1 py-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-hi)]">
                {col.label}
              </span>
              <span className="font-mono text-[10px] text-[var(--muted-hi)]">{colItems.length}</span>
            </div>
            {colItems.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                assignee={t.assignee_id ? (memberById.get(t.assignee_id) ?? null) : null}
                epic={t.epic_id ? (epicById.get(t.epic_id) ?? null) : null}
                acting={acting.has(t.id)}
                move={move}
                togglePullable={togglePullable}
                onOpen={() => onOpen(t)}
                allStages={allStages}
                lanes={lanes}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function Kanban({ tickets, members = [] }: { tickets: Ticket[]; members?: Member[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const epics = useEpics();
  const me = useCurrentMember();
  const [acting, setActing] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [groupBySwimlane, setGroupBySwimlane] = useState(true);
  const watchRef = useRef<Set<string>>(new Set());

  const activeBuild = useUIStore((s) => s.activeBuild);
  const workflowStages = useWorkflowStages();
  const workflowSwimlanes = useWorkflowSwimlanes();
  const stages: StageDef[] = useMemo(
    () => resolveStages(workflowStages.data, activeBuild, "ticket"),
    [workflowStages.data, activeBuild],
  );
  const lanes: SwimlaneDef[] = useMemo(
    () => resolveSwimlanes(workflowSwimlanes.data, activeBuild),
    [workflowSwimlanes.data, activeBuild],
  );
  const columns = useMemo(() => {
    const cols = stages.map((s) => ({ key: s.key, label: s.label }));
    const backlogIdx = cols.findIndex((c) => c.key === "backlog");
    if (backlogIdx !== -1) {
      cols.splice(backlogIdx + 1, 0, { key: "backlog_pullable", label: "Backlog — Pullable" });
    }
    return cols;
  }, [stages]);
  const allStages = useMemo(() => [...stages.map((s) => s.key), "archived"], [stages]);

  const boardFilters = useBoardFilters();
  const activeFilterIds = useUIStore((s) => s.activeTicketFilterIds);
  const openWorkItem = useUIStore((s) => s.openWorkItem);
  const setOpenWorkItem = useUIStore((s) => s.setOpenWorkItem);
  const setActiveCard = useUIStore((s) => s.setActiveCard);

  useEffect(() => {
    if (openWorkItem?.type !== "ticket") return;
    const t = tickets.find((x) => x.key === openWorkItem.key);
    if (t) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local drawer selection to an external Zustand signal set by a lineage-link click elsewhere in the tree
      setSelected(t);
      setOpenWorkItem(null);
    }
  }, [openWorkItem, tickets, setOpenWorkItem]);

  useEffect(() => {
    setActiveCard(selected ? { type: "ticket", key: selected.key } : null);
  }, [selected, setActiveCard]);
  const activeConfigs = useMemo(
    () =>
      (boardFilters.data ?? [])
        .filter((f) => activeFilterIds.includes(f.id))
        .map((f) => f.config as BoardFilterConfig),
    [boardFilters.data, activeFilterIds],
  );
  const { tickets: visibleTickets, hiddenColumns } = useMemo(
    () => applyActiveFilters(tickets, activeConfigs),
    [tickets, activeConfigs],
  );

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const epicById = useMemo(() => new Map((epics.data ?? []).map((e) => [e.id, e])), [epics.data]);

  // Subscribe to action_log so the cascade trail surfaces as toasts after a drag.
  useEffect(() => {
    const channel = supabase
      .channel("kanban:action_log")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "action_log" },
        (payload) => {
          const row = payload.new as Tables<"action_log">;
          // Only surface entries for cascades we just triggered.
          if (watchRef.current.size > 0) {
            toast.push(`⚡ ${row.summary}`, row.status === "failed" ? "error" : "info");
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast]);

  // Every stage move re-assigns the ticket to whoever moved it (advance_ticket
  // does this server-side); optimistic update mirrors that so the card doesn't
  // flash back to the old assignee before the round-trip confirms it.
  async function move(ticket: Ticket, toColumn: string) {
    // "backlog_pullable" is a UI-only column key — it maps to stage="backlog"
    // with pullable=true rather than a real stage transition.
    const toStage = toColumn === "backlog_pullable" ? "backlog" : toColumn;
    // Any real stage change clears pullable — it's a per-column signal, not a
    // property that should carry over into wherever the ticket lands next.
    const nextPullable =
      toColumn === "backlog_pullable" ? true : toStage !== ticket.stage ? false : ticket.pullable;

    if (ticket.stage === toStage && ticket.pullable === nextPullable) return;
    const fromStage = ticket.stage;
    const fromPullable = ticket.pullable;
    const fromAssignee = ticket.assignee_id;
    const key = ["tickets"];

    qc.setQueriesData<Ticket[]>({ queryKey: key }, (old) =>
      old?.map((t) =>
        t.id === ticket.id
          ? { ...t, stage: toStage, pullable: nextPullable, assignee_id: me.data?.id ?? t.assignee_id }
          : t,
      ),
    );
    setActing((s) => new Set(s).add(ticket.id));
    watchRef.current.add(ticket.id);

    let error: { message: string } | null = null;
    if (ticket.stage !== toStage) {
      ({ error } = await supabase.rpc("advance_ticket", {
        p_ticket_id: ticket.id,
        p_to_stage: toStage,
      }));
    }
    if (!error && ticket.pullable !== nextPullable) {
      ({ error } = await supabase.from("tickets").update({ pullable: nextPullable }).eq("id", ticket.id));
    }

    setActing((s) => {
      const n = new Set(s);
      n.delete(ticket.id);
      return n;
    });

    if (error) {
      qc.setQueriesData<Ticket[]>({ queryKey: key }, (old) =>
        old?.map((t) =>
          t.id === ticket.id ? { ...t, stage: fromStage, pullable: fromPullable, assignee_id: fromAssignee } : t,
        ),
      );
      toast.push(`Move failed: ${error.message}`, "error");
      watchRef.current.delete(ticket.id);
      return;
    }

    toast.push(`Moved “${ticket.title}” → ${toStage} · assigned to you`, "success");
    setTimeout(() => watchRef.current.delete(ticket.id), 4000);
    qc.invalidateQueries({ queryKey: key });
  }

  async function togglePullable(ticket: Ticket) {
    const next = !ticket.pullable;
    const key = ["tickets"];
    qc.setQueriesData<Ticket[]>({ queryKey: key }, (old) =>
      old?.map((t) => (t.id === ticket.id ? { ...t, pullable: next } : t)),
    );
    const { error } = await supabase.from("tickets").update({ pullable: next }).eq("id", ticket.id);
    if (error) {
      qc.setQueriesData<Ticket[]>({ queryKey: key }, (old) =>
        old?.map((t) => (t.id === ticket.id ? { ...t, pullable: !next } : t)),
      );
      toast.push(`Update failed: ${error.message}`, "error");
      return;
    }
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-end gap-3">
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--muted-hi)]">
          <input
            type="checkbox"
            checked={groupBySwimlane}
            onChange={(e) => setGroupBySwimlane(e.target.checked)}
          />
          Group by swimlane
        </label>
        <BoardFilters />
      </div>
      {groupBySwimlane ? (
        <div className="space-y-4">
          {lanes.map((lane) => {
            const items = visibleTickets.filter((t) => t.swimlane === lane.key);
            if (items.length === 0) return null;
            return (
              <div key={lane.key}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span style={{ color: lane.color }}>{lane.icon}</span>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-hi)]">
                    {lane.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--muted-hi)]">{items.length}</span>
                </div>
                <ColumnsGrid
                  items={items}
                  allTickets={visibleTickets}
                  acting={acting}
                  memberById={memberById}
                  epicById={epicById}
                  move={move}
                  togglePullable={togglePullable}
                  onOpen={setSelected}
                  hiddenColumns={hiddenColumns}
                  columns={columns}
                  allStages={allStages}
                  lanes={lanes}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <ColumnsGrid
          items={visibleTickets}
          allTickets={visibleTickets}
          acting={acting}
          memberById={memberById}
          epicById={epicById}
          move={move}
          togglePullable={togglePullable}
          onOpen={setSelected}
          hiddenColumns={hiddenColumns}
          columns={columns}
          allStages={allStages}
          lanes={lanes}
        />
      )}
      {selected && <TicketDrawer key={selected.id} ticket={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
