"use client";

import { useState } from "react";
import { useActionLog } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/format";

const STATUS_TONE: Record<string, "green" | "red" | "amber" | "muted"> = {
  success: "green",
  approved: "green",
  failed: "red",
  rejected: "red",
  awaiting_approval: "amber",
  skipped: "muted",
};

export default function ActivityPage() {
  const log = useActionLog(200);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const rows = (log.data ?? []).filter((a) => {
    if (status !== "all" && a.status !== status) return false;
    if (q && !`${a.summary} ${a.action_type} ${a.actor}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Audit Trail</SectionTitle>
        <div className="flex items-center gap-2">
          <input
            placeholder="Filter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] px-3 py-1.5 text-sm text-[var(--white)] outline-none focus:border-[var(--cyan)]"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] px-2 py-1.5 text-sm text-[var(--white)]"
          >
            {["all", "success", "failed", "awaiting_approval", "approved", "rejected", "skipped"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No audit entries"
          hint="Every autonomous action JARVIS takes is recorded here, append-only, with actor and before/after state."
        />
      ) : (
        <Card className="divide-y divide-[var(--glass-border)] p-0">
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <Badge tone={STATUS_TONE[a.status] ?? "muted"}>{a.status}</Badge>
              <span className="flex-1 text-sm text-[var(--white)]">{a.summary}</span>
              <span className="font-mono text-[10px] text-[var(--muted-hi)]">{a.action_type}</span>
              <span className="font-mono text-[10px] text-[var(--muted)]">{a.actor}</span>
              <span className="font-mono text-[10px] text-[var(--muted)]">{timeAgo(a.created_at)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
