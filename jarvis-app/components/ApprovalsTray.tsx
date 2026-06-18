"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, usePendingApprovals, useBuilds } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { Tables } from "@/lib/database.types";

type Approval = Tables<"approvals">;
type ActionSpec = { type: string; params?: Record<string, unknown> };

// Risk → Badge tone (spec §11: low green, medium amber, high red).
const RISK_TONE: Record<string, "green" | "amber" | "red"> = {
  low: "green",
  medium: "amber",
  high: "red",
};
// High-risk first: the most consequential gates sit at the top (spec §10.4).
const RISK_ORDER = ["high", "medium", "low"] as const;

/** Top-bar bell: count of pending approvals in the active scope; opens the tray. */
export function ApprovalsBell() {
  const approvals = usePendingApprovals();
  const setOpen = useUIStore((s) => s.setApprovalsOpen);
  const count = approvals.data?.length ?? 0;

  return (
    <button
      onClick={() => setOpen(true)}
      className="relative text-[var(--muted-hi)] transition hover:text-[var(--white)]"
      aria-label={`Approvals (${count} pending)`}
      title={`${count} pending approval${count === 1 ? "" : "s"}`}
    >
      <span aria-hidden className="text-base leading-none">🔔</span>
      {count > 0 && (
        <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--warn)] px-1 font-mono text-[9px] font-bold text-black tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

/** Slide-over listing pending approvals, grouped by risk (spec §10.4). */
export function ApprovalsTray() {
  const open = useUIStore((s) => s.approvalsOpen);
  const setOpen = useUIStore((s) => s.setApprovalsOpen);
  const approvals = usePendingApprovals();
  const builds = useBuilds();

  const buildColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of builds.data ?? []) m.set(b.id, b.color);
    return m;
  }, [builds.data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const items = approvals.data ?? [];
  const groups = RISK_ORDER.map((risk) => ({
    risk,
    rows: items.filter((a) => a.risk === risk),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setOpen(false)}>
      <aside
        className="glass flex h-full w-full max-w-md flex-col border-l border-[var(--glass-border)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Approvals"
      >
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-5 py-3">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold text-[var(--white)]">Approvals</h3>
            <Badge tone={items.length ? "amber" : "muted"}>{items.length}</Badge>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-[var(--muted-hi)] hover:text-[var(--white)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="pt-8 text-center text-sm text-[var(--muted-hi)]">
              No pending approvals. Gated actions that need a human decision will appear here.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.risk} className="space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {g.risk} risk
                </p>
                {g.rows.map((a) => (
                  <ApprovalCard key={a.id} approval={a} color={a.build_id ? buildColor.get(a.build_id) : undefined} />
                ))}
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function ApprovalCard({ approval, color }: { approval: Approval; color?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [deciding, setDeciding] = useState(false);

  const actions = (Array.isArray(approval.action_spec) ? approval.action_spec : []) as ActionSpec[];

  async function decide(decision: "approved" | "rejected") {
    setDeciding(true);
    // Optimistic: drop the card from every cached approvals query.
    const snapshot = qc.getQueriesData<Approval[]>({ queryKey: ["approvals"] });
    qc.setQueriesData<Approval[]>({ queryKey: ["approvals"] }, (old) =>
      old?.filter((x) => x.id !== approval.id),
    );

    const { error } = await supabase.rpc("decide_approval", {
      p_approval_id: approval.id,
      p_decision: decision,
    });

    if (error) {
      // Roll back to the pre-decision cache.
      for (const [key, data] of snapshot) qc.setQueryData(key, data);
      setDeciding(false);
      toast.push(`Approval failed: ${error.message}`, "error");
      return;
    }

    toast.push(
      decision === "approved" ? `Approved “${approval.title}” — executing…` : `Rejected “${approval.title}”`,
      decision === "approved" ? "success" : "info",
    );
    // Realtime + invalidation reconcile the cache and stream the cascade.
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }

  return (
    <article className="rounded-lg border border-[var(--glass-border-2)] bg-[var(--elevated)] p-3">
      <div className="flex items-start gap-2">
        {color && <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--white)]">{approval.title}</p>
          {approval.description && (
            <p className="mt-0.5 text-xs text-[var(--muted-hi)]">{approval.description}</p>
          )}
        </div>
        <Badge tone={RISK_TONE[approval.risk] ?? "muted"}>{approval.risk}</Badge>
      </div>

      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {actions.map((a, i) => (
            <span
              key={i}
              className="rounded border border-[var(--glass-border-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted-hi)]"
            >
              {a.type}
            </span>
          ))}
        </div>
      )}

      {approval.preview != null && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--void-2)] p-2 font-mono text-[10px] text-[var(--muted-hi)]">
          {typeof approval.preview === "string"
            ? approval.preview
            : JSON.stringify(approval.preview, null, 2)}
        </pre>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => decide("approved")}
          disabled={deciding}
          className="rounded-lg bg-[var(--cyan)] px-3 py-1.5 text-xs font-semibold text-black transition hover:shadow-[0_0_24px_rgba(0,229,255,0.35)] disabled:opacity-60"
        >
          Approve
        </button>
        <button
          onClick={() => decide("rejected")}
          disabled={deciding}
          className="rounded-lg border border-[var(--glass-border-2)] px-3 py-1.5 text-xs text-[var(--muted-hi)] transition hover:text-[var(--white)] disabled:opacity-60"
        >
          Reject
        </button>
        <span className="ml-auto font-mono text-[10px] text-[var(--muted)]">{timeAgo(approval.created_at)}</span>
      </div>
    </article>
  );
}
