"use client";

import { useState } from "react";
import { useTickets, useBuilds } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { MetricCard, SectionTitle, EmptyState } from "@/components/ui";
import { Kanban } from "@/components/Kanban";
import { NewIssueModal } from "@/components/NewIssueModal";
import { primaryBtn } from "@/components/Modal";

export default function EngineeringPage() {
  const tickets = useTickets();
  const builds = useBuilds();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const [issueOpen, setIssueOpen] = useState(false);

  const all = tickets.data ?? [];
  const open = all.filter((t) => t.stage !== "done" && t.stage !== "archived").length;
  const inProgress = all.filter((t) => t.stage === "in_progress").length;
  const done = all.filter((t) => t.stage === "done").length;

  const hasBuilds = (builds.data?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Open" value={open} />
        <MetricCard label="In Progress" value={inProgress} />
        <MetricCard label="Done" value={done} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Kanban — drag to advance</SectionTitle>
          {hasBuilds && (
            <button className={primaryBtn} onClick={() => setIssueOpen(true)}>
              + New issue
            </button>
          )}
        </div>

        {!hasBuilds ? (
          <EmptyState
            title="No builds yet"
            hint="Add a build from the Overview tab before creating issues."
          />
        ) : all.length === 0 ? (
          <EmptyState
            title="No issues"
            hint="Create one, then drag it to Done to watch the rules engine cascade (recompute health → notify → audit)."
            action={
              <button className={primaryBtn} onClick={() => setIssueOpen(true)}>
                + New issue
              </button>
            }
          />
        ) : (
          <Kanban tickets={all} />
        )}
      </section>

      <NewIssueModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />
    </div>
  );
}
