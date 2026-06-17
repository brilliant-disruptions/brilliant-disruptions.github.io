"use client";

import { useAgents } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge } from "@/components/ui";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "cyan" | "muted"> = {
  ok: "green",
  running: "cyan",
  error: "red",
  disabled: "muted",
  idle: "amber",
};

export default function AgentsPage() {
  const agents = useAgents();

  return (
    <div className="space-y-4">
      <SectionTitle>Agent Fleet</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.data?.map((a) => (
          <Card key={a.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-[var(--white)]">{a.name}</span>
              <Badge tone={STATUS_TONE[a.status] ?? "muted"}>{a.status}</Badge>
            </div>
            <p className="text-xs text-[var(--muted-hi)]">{a.description}</p>
            <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--muted)]">
              <span>scope: {a.build_scope}</span>
              {a.schedule_cron ? <span>· cron: {a.schedule_cron}</span> : <span>· event/manual</span>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
