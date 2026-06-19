"use client";

import { useState } from "react";
import {
  useBuilds,
  useTickets,
  useRevenue,
  useExpenses,
  useAgents,
  useActionLog,
  useMilestones,
  useRepoActivity,
  useConnections,
} from "@/lib/queries/hooks";
import { Card, MetricCard, SectionTitle, HealthRing, Badge, EmptyState } from "@/components/ui";
import { NewBuildModal } from "@/components/NewBuildModal";
import { BuildSettingsModal } from "@/components/BuildSettingsModal";
import { ImportFromGitHubModal } from "@/components/ImportFromGitHubModal";
import { TriageInbox } from "@/components/TriageInbox";
import { money, timeAgo } from "@/lib/format";
import { primaryBtn, ghostBtn } from "@/components/Modal";
import type { Tables } from "@/lib/database.types";

export default function OverviewPage() {
  const builds = useBuilds();
  const tickets = useTickets();
  const revenue = useRevenue();
  const expenses = useExpenses();
  const agents = useAgents();
  const milestones = useMilestones();
  const repoActivity = useRepoActivity();
  const connections = useConnections();
  const log = useActionLog(25);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [manage, setManage] = useState<Tables<"builds"> | null>(null);

  const githubConnected =
    (connections.data ?? []).find((c) => c.provider === "github")?.status === "connected";

  // Recent commits/PRs grouped by build (the GitHub adapter populates this).
  const activityByBuild = (repoActivity.data ?? []).reduce<Record<string, typeof repoActivity.data>>(
    (acc, a) => {
      (acc[a.build_id] ??= []).push(a);
      return acc;
    },
    {},
  );

  // Per-build milestone progress (the chosen "progress" metric). Company-wide
  // milestones (build_id null) belong to no single build, so they're excluded.
  const milestonesByBuild = (milestones.data ?? []).reduce<Record<string, typeof milestones.data>>(
    (acc, m) => {
      if (!m.build_id) return acc;
      (acc[m.build_id] ??= []).push(m);
      return acc;
    },
    {},
  );

  const portfolioMrr = (revenue.data ?? []).reduce((s, r) => s + r.mrr_cents, 0);
  const openIssues = (tickets.data ?? []).filter(
    (t) => t.stage !== "done" && t.stage !== "archived",
  ).length;
  const monthlyBurn = (expenses.data ?? [])
    .filter((e) => e.is_recurring)
    .reduce((s, e) => s + e.amount_cents, 0);
  const activeAgents = (agents.data ?? []).filter(
    (a) => a.is_enabled && a.status !== "disabled",
  ).length;

  const noBuilds = builds.isSuccess && (builds.data?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Portfolio MRR" value={money(portfolioMrr)} />
        <MetricCard label="Open Issues" value={openIssues} />
        <MetricCard label="Monthly Burn" value={money(monthlyBurn)} sub="recurring" />
        <MetricCard label="Active Agents" value={activeAgents} sub={`${agents.data?.length ?? 0} total`} />
      </div>

      <TriageInbox />

      {noBuilds ? (
        <EmptyState
          title="No builds yet"
          hint="Connect GitHub to auto-discover builds from your repos, or add a non-code initiative manually to get started."
          action={
            <button className={primaryBtn} onClick={() => setAddOpen(true)}>
              + Add a build
            </button>
          }
        />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Build Matrix</SectionTitle>
            <div className="flex gap-2">
              <button className={ghostBtn} onClick={() => setImportOpen(true)}>
                Import from GitHub
              </button>
              <button className={primaryBtn} onClick={() => setAddOpen(true)}>
                + Add build
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {builds.data?.map((b) => (
              <BuildMatrixCard
                key={b.id}
                build={b}
                milestones={milestonesByBuild[b.id] ?? []}
                activity={activityByBuild[b.id] ?? []}
                githubConnected={githubConnected}
                onManage={() => setManage(b)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Live Activity</SectionTitle>
        {(log.data?.length ?? 0) === 0 ? (
          <Card>
            <p className="text-sm text-[var(--muted-hi)]">
              No actions logged yet. Advance a ticket or log an expense to see the
              event cascade here in real time.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-[var(--glass-border)] p-0">
            {log.data?.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <StatusDot status={a.status} />
                <span className="flex-1 text-sm text-[var(--white)]">{a.summary}</span>
                <span className="font-mono text-[10px] text-[var(--muted-hi)]">
                  {a.action_type}
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {timeAgo(a.created_at)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <NewBuildModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingCount={builds.data?.length ?? 0}
      />
      {importOpen && <ImportFromGitHubModal onClose={() => setImportOpen(false)} />}
      {manage && <BuildSettingsModal build={manage} onClose={() => setManage(null)} />}
    </div>
  );
}

function BuildMatrixCard({
  build: b,
  milestones,
  activity,
  githubConnected,
  onManage,
}: {
  build: Tables<"builds">;
  milestones: Tables<"milestones">[];
  activity: Tables<"repo_activity">[];
  githubConnected: boolean;
  onManage: () => void;
}) {
  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  // Next = first not-done milestone in sort order (the data arrives sorted).
  const next = milestones.find((m) => m.status !== "done" && m.status !== "missed");
  const recent = activity.slice(0, 4);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <HealthRing score={b.health_score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.color }} />
            <span className="truncate font-display font-semibold text-[var(--white)]">{b.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="cyan">{b.stage}</Badge>
            {b.revenue_model && b.revenue_model !== "none" && (
              <span className="font-mono text-[10px] text-[var(--muted-hi)]">{b.revenue_model}</span>
            )}
            {b.github_repo && (
              <a
                href={`https://github.com/${b.github_repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-[var(--muted-hi)] underline-offset-2 hover:text-[var(--cyan)] hover:underline"
                title={`Open ${b.github_repo} on GitHub`}
              >
                ↗ {b.github_repo}
              </a>
            )}
          </div>
        </div>
        <button
          onClick={onManage}
          title="Manage build (edit, link GitHub, delete)"
          className="shrink-0 self-start rounded-md border border-[var(--glass-border-2)] px-2 py-1 font-mono text-[11px] text-[var(--muted-hi)] transition hover:border-[var(--cyan)] hover:text-[var(--white)]"
        >
          ⚙
        </button>
      </div>

      {/* Milestone progress (the build's spec/delivery progress) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted-hi)]">
            Milestones
          </span>
          <span className="font-mono text-[10px] text-[var(--muted-hi)] tabular-nums">
            {total > 0 ? `${done}/${total} done` : "none yet"}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-border-2)]">
          <div
            className="h-full rounded-full bg-[var(--cyan)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {next ? (
          <p className="truncate font-mono text-[10px] text-[var(--muted)]">next: {next.title}</p>
        ) : total > 0 ? (
          <p className="font-mono text-[10px] text-[var(--success)]">all milestones complete</p>
        ) : (
          <p className="font-mono text-[10px] text-[var(--muted)]">add milestones to track progress</p>
        )}
      </div>

      {/* Recent GitHub changes (commits/PRs) — dark until GitHub is connected */}
      <div className="space-y-1 border-t border-[var(--glass-border)] pt-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted-hi)]">
          Recent changes
        </span>
        {recent.length > 0 ? (
          <ul className="space-y-0.5">
            {recent.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-[var(--muted)]">
                  {a.kind === "pull_request" ? "PR" : "·"}
                </span>
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[11px] text-[var(--muted-hi)] hover:text-[var(--cyan)]"
                  >
                    {a.ref ? `${a.ref} ` : ""}
                    {a.title}
                  </a>
                ) : (
                  <span className="truncate text-[11px] text-[var(--muted-hi)]">{a.title}</span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--muted)]">
                  {timeAgo(a.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : !b.github_repo ? (
          <p className="font-mono text-[10px] text-[var(--muted)]">no repo linked</p>
        ) : githubConnected ? (
          <p className="font-mono text-[10px] text-[var(--muted)]">no recent commits or PRs</p>
        ) : (
          <p className="font-mono text-[10px] text-[var(--muted)]">connect GitHub to see commits &amp; PRs</p>
        )}
      </div>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === "success" || status === "approved"
      ? "var(--success)"
      : status === "failed" || status === "rejected"
        ? "var(--danger)"
        : status === "awaiting_approval"
          ? "var(--warn)"
          : "var(--muted)";
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />;
}
