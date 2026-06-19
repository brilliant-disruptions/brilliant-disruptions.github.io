"use client";

import { useState } from "react";
import { useAgents, useAgentRuns, supabase } from "@/lib/queries/hooks";
import { useToast } from "@/components/Toast";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { Tables } from "@/lib/database.types";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "cyan" | "muted"> = {
  ok: "green",
  running: "cyan",
  error: "red",
  disabled: "muted",
  idle: "amber",
};

// Workers wired in the event-processor (dispatchAgent). RUNNABLE agents can be
// triggered by hand here; EVENT_DRIVEN ones are implemented but only meaningful
// with event/cron context (a decision, a domain change), so manual run is off.
// Everything else has no worker yet and is honestly labelled — no fake button.
const RUNNABLE = new Set(["briefing", "financial_modeler", "feedback_monitor"]);
const EVENT_DRIVEN = new Set(["premortem_analyst", "postmortem_analyst", "health_recomputer"]);

const RUN_TONE: Record<string, "green" | "red" | "cyan" | "muted"> = {
  success: "green",
  error: "red",
  running: "cyan",
};

export default function AgentsPage() {
  const agents = useAgents();
  const runs = useAgentRuns();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const nameBySlug = new Map((agents.data ?? []).map((a) => [a.slug, a.name] as const));
  const nameById = new Map((agents.data ?? []).map((a) => [a.id, a.name] as const));

  async function run(slug: string) {
    setBusy(slug);
    const { error } = await supabase.rpc("request_agent_run", { p_slug: slug, p_input: {} });
    setBusy(null);
    if (error) return toast.push(error.message, "error");
    toast.push(`Dispatched ${nameBySlug.get(slug) ?? slug}`, "success");
  }

  return (
    <div className="space-y-6">
      <SectionTitle>Agent Fleet</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.data?.map((a) => {
          const runnable = RUNNABLE.has(a.slug) && a.is_enabled;
          const eventDriven = EVENT_DRIVEN.has(a.slug);
          const implemented = runnable || eventDriven;
          return (
            <Card key={a.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-[var(--white)]">{a.name}</span>
                <Badge tone={STATUS_TONE[a.status] ?? "muted"}>{a.status}</Badge>
              </div>
              <p className="text-xs text-[var(--muted-hi)]">{a.description}</p>
              <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--muted)]">
                <span>scope: {a.build_scope}</span>
                {a.schedule_cron ? <span>· cron: {a.schedule_cron}</span> : <span>· event/manual</span>}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                {!implemented && (
                  <span className="font-mono text-[10px] text-[var(--warn)]">not yet implemented</span>
                )}
                {implemented && !runnable && (
                  <span className="font-mono text-[10px] text-[var(--muted)]">event-driven</span>
                )}
                <button
                  disabled={!runnable || busy === a.slug}
                  onClick={() => run(a.slug)}
                  title={
                    runnable
                      ? "Dispatch this agent now"
                      : eventDriven
                        ? "Runs automatically on events / schedule"
                        : "No worker implemented yet"
                  }
                  className="ml-auto rounded-md border border-[var(--glass-border-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted-hi)] transition enabled:hover:border-[var(--cyan)] enabled:hover:text-[var(--white)] disabled:opacity-40"
                >
                  {busy === a.slug ? "Dispatching…" : "Run now"}
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <section className="space-y-3">
        <SectionTitle>Run history</SectionTitle>
        {(runs.data?.length ?? 0) === 0 ? (
          <EmptyState title="No runs yet" hint="Dispatch an agent above to see its run recorded here." />
        ) : (
          <Card className="divide-y divide-[var(--glass-border)] p-0">
            {runs.data?.map((r: Tables<"agent_runs">) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge tone={RUN_TONE[r.status] ?? "muted"}>{r.status}</Badge>
                <span className="flex-1 truncate text-sm text-[var(--white)]">
                  {nameById.get(r.agent_id) ?? "—"}
                  {r.error ? (
                    <span className="text-[var(--danger)]"> · {r.error}</span>
                  ) : (
                    (r.output as { summary?: string } | null)?.summary && (
                      <span className="text-[var(--muted-hi)]"> · {(r.output as { summary?: string }).summary}</span>
                    )
                  )}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">{r.trigger}</span>
                <span className="font-mono text-[10px] text-[var(--muted)]">{timeAgo(r.started_at)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
