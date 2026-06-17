"use client";

import { useProspects, useBuilds } from "@/lib/queries/hooks";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";

const FUNNEL = ["new", "sent", "engaged", "replied", "qualified", "call_booked", "won", "lost"];

export default function GrowthPage() {
  const prospects = useProspects();
  const builds = useBuilds();
  const rows = prospects.data ?? [];

  const counts = FUNNEL.reduce<Record<string, number>>((acc, s) => {
    acc[s] = rows.filter((p) => p.status === s).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <SectionTitle>Outreach Funnel</SectionTitle>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {FUNNEL.map((s) => (
          <Card key={s} className="text-center">
            <div className="font-display text-xl font-bold text-[var(--white)] tabular-nums">
              {counts[s]}
            </div>
            <div className="font-mono text-[9px] uppercase text-[var(--muted-hi)]">{s}</div>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No prospects"
          hint={
            (builds.data?.length ?? 0) === 0
              ? "Add a build first; prospects attach to a build."
              : "The prospecting agent populates this once Gmail/Maps are connected (Phase 3). Add manually anytime."
          }
        />
      ) : (
        <Card className="divide-y divide-[var(--glass-border)] p-0">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 text-sm text-[var(--white)]">{p.company}</span>
              {p.signal && <span className="font-mono text-[10px] text-[var(--cyan)]">{p.signal}</span>}
              <Badge tone="cyan">{p.status}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
