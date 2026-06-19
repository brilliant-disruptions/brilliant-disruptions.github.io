"use client";

import { useState } from "react";
import { useProspects, useBuilds } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { NewProspectModal } from "@/components/NewProspectModal";
import { primaryBtn } from "@/components/Modal";

const FUNNEL = ["new", "sent", "engaged", "replied", "qualified", "call_booked", "won", "lost"];

export default function GrowthPage() {
  const prospects = useProspects();
  const builds = useBuilds();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [open, setOpen] = useState(false);
  const rows = prospects.data ?? [];
  const hasBuilds = (builds.data?.length ?? 0) > 0;

  const counts = FUNNEL.reduce<Record<string, number>>((acc, s) => {
    acc[s] = rows.filter((p) => p.status === s).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionTitle>Outreach Funnel</SectionTitle>
        {hasBuilds && (
          <button className={primaryBtn} onClick={() => setOpen(true)}>
            + Add prospect
          </button>
        )}
      </div>
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
            !hasBuilds
              ? "Add a build first; prospects attach to a build."
              : "The prospecting agent populates this once Gmail/Maps are connected. Add manually anytime."
          }
          action={
            hasBuilds ? (
              <button className={primaryBtn} onClick={() => setOpen(true)}>
                + Add prospect
              </button>
            ) : undefined
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

      <NewProspectModal
        open={open}
        onClose={() => setOpen(false)}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />
    </div>
  );
}
