"use client";

import { useMemo, useState } from "react";
import { useBuilds, useContributions, useMembers } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { SectionTitle, Card, EmptyState, Badge } from "@/components/ui";
import { NewContributionModal } from "@/components/NewContributionModal";
import { EditContributionModal } from "@/components/EditContributionModal";
import type { Tables } from "@/lib/database.types";
import { primaryBtn } from "@/components/Modal";
import { money } from "@/lib/format";

/** Owner capital: cash, gear, and personally-paid expenses put into the
 *  business, and how much of it the company still owes back. */
export function ContributionsTab() {
  const contributions = useContributions();
  const members = useMembers();
  const builds = useBuilds();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [contribOpen, setContribOpen] = useState(false);
  const [editContrib, setEditContrib] = useState<Tables<"contributions"> | null>(null);

  const contribs = contributions.data ?? [];
  const totalContributed = contribs.reduce((s, c) => s + c.amount_cents, 0);
  const owedBack = contribs
    .filter((c) => c.repayable && !c.repaid_on)
    .reduce((s, c) => s + c.amount_cents, 0);
  const memberName = useMemo(() => {
    const map = new Map((members.data ?? []).map((m) => [m.id, m.full_name]));
    return (id: string) => map.get(id) ?? "—";
  }, [members.data]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle>
          Contributions · {money(totalContributed)} in
          {owedBack > 0 ? ` · ${money(owedBack)} owed` : ""}
        </SectionTitle>
        {(members.data?.length ?? 0) > 0 && (
          <button className={primaryBtn} onClick={() => setContribOpen(true)}>
            + Log contribution
          </button>
        )}
      </div>
      {contribs.length === 0 ? (
        <EmptyState
          title="No contributions logged"
          hint="Track cash, gear, or expenses you've personally put into the business."
        />
      ) : (
        <Card className="divide-y divide-[var(--glass-border)] p-0">
          {contribs.map((c) => (
            <button
              key={c.id}
              onClick={() => setEditContrib(c)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
              title="Edit contribution"
            >
              <Badge tone="muted">{c.kind}</Badge>
              <span className="block min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--white)]">{c.description}</span>
                <span className="text-[10px] text-[var(--muted)]">{memberName(c.member_id)}</span>
              </span>
              {c.repayable &&
                (c.repaid_on ? <Badge tone="green">repaid</Badge> : <Badge tone="amber">owed</Badge>)}
              <span className="font-mono text-sm text-[var(--white)] tabular-nums">
                {money(c.amount_cents)}
              </span>
              <span className="font-mono text-[10px] text-[var(--muted)]">{c.contributed_on}</span>
            </button>
          ))}
        </Card>
      )}

      <NewContributionModal
        open={contribOpen}
        onClose={() => setContribOpen(false)}
        members={members.data ?? []}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />

      {editContrib && (
        <EditContributionModal
          key={editContrib.id}
          contribution={editContrib}
          members={members.data ?? []}
          builds={builds.data ?? []}
          onClose={() => setEditContrib(null)}
        />
      )}
    </section>
  );
}
