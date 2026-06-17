"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Badge, Tag } from "@/components/ui";
import type { Tables } from "@/lib/database.types";

type Ticket = Tables<"tickets">;

const COLUMNS: { key: string; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];
const ALL_STAGES = [...COLUMNS.map((c) => c.key), "archived"];

const PRIORITY_TONE: Record<string, "red" | "amber" | "cyan" | "muted"> = {
  critical: "red",
  high: "amber",
  medium: "cyan",
  low: "muted",
};

export function Kanban({ tickets }: { tickets: Ticket[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [acting, setActing] = useState<Set<string>>(new Set());
  const watchRef = useRef<Set<string>>(new Set());

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

  async function move(ticket: Ticket, toStage: string) {
    if (ticket.stage === toStage) return;
    const fromStage = ticket.stage;
    const key = ["tickets"];

    // Optimistic update across any cached tickets query.
    qc.setQueriesData<Ticket[]>({ queryKey: key }, (old) =>
      old?.map((t) => (t.id === ticket.id ? { ...t, stage: toStage } : t)),
    );
    setActing((s) => new Set(s).add(ticket.id));
    watchRef.current.add(ticket.id);

    const { error } = await supabase.rpc("advance_ticket", {
      p_ticket_id: ticket.id,
      p_to_stage: toStage,
    });

    setActing((s) => {
      const n = new Set(s);
      n.delete(ticket.id);
      return n;
    });

    if (error) {
      // Roll back.
      qc.setQueriesData<Ticket[]>({ queryKey: key }, (old) =>
        old?.map((t) => (t.id === ticket.id ? { ...t, stage: fromStage } : t)),
      );
      toast.push(`Move failed: ${error.message}`, "error");
      watchRef.current.delete(ticket.id);
      return;
    }

    toast.push(`Moved “${ticket.title}” → ${toStage}`, "success");
    // Stop watching cascade after a short grace window.
    setTimeout(() => watchRef.current.delete(ticket.id), 4000);
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = tickets.filter((t) => t.stage === col.key);
        return (
          <div
            key={col.key}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/plain");
              const t = tickets.find((x) => x.id === id);
              if (t) move(t, col.key);
            }}
            className="flex min-h-[200px] flex-col gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--surface)]/40 p-2"
          >
            <div className="flex items-center justify-between px-1 py-1">
              <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--muted-hi)]">
                {col.label}
              </span>
              <span className="font-mono text-[10px] text-[var(--muted)]">{items.length}</span>
            </div>
            {items.map((t) => (
              <article
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                className="group cursor-grab rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] p-2.5 active:cursor-grabbing"
              >
                <div className="flex items-center gap-2">
                  <Badge tone={PRIORITY_TONE[t.priority] ?? "muted"}>{t.priority}</Badge>
                  {t.is_blocker && <Badge tone="red">blocker</Badge>}
                  {acting.has(t.id) && (
                    <span className="font-mono text-[10px] text-[var(--cyan)]">⚡ acting…</span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-[var(--white)]">{t.title}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {t.ref && <Tag>{t.ref}</Tag>}
                  <Tag>{t.type}</Tag>
                  {/* Keyboard / no-drag fallback (accessibility, spec §10.6) */}
                  <select
                    aria-label={`Move ${t.title} to another stage`}
                    value={t.stage}
                    onChange={(e) => move(t, e.target.value)}
                    className="ml-auto rounded border border-[var(--glass-border-2)] bg-[var(--void-2)] px-1 py-0.5 font-mono text-[10px] text-[var(--muted-hi)]"
                  >
                    {ALL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </article>
            ))}
          </div>
        );
      })}
    </div>
  );
}
