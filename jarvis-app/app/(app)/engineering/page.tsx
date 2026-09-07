"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTickets, useBuilds, useMembers } from "@/lib/queries/hooks";
import { useUIStore } from "@/lib/store";
import { GROUP_BY_OPTIONS, type ItemType } from "@/lib/board-constants";
import { MetricCard, EmptyState } from "@/components/ui";
import { Kanban } from "@/components/Kanban";
import { EpicsBoard } from "@/components/EpicsBoard";
import { InitiativesBoard } from "@/components/InitiativesBoard";
import { EngineeringAnalytics } from "@/components/EngineeringAnalytics";
import { WorkflowRulesEditor } from "@/components/WorkflowRulesEditor";
import { StagesEditor } from "@/components/StagesEditor";
import { SwimlanesEditor } from "@/components/SwimlanesEditor";
import { LoadTemplateButton } from "@/components/LoadTemplateButton";
import { NewIssueModal } from "@/components/NewIssueModal";
import { BoardFilters } from "@/components/BoardFilters";
import { BuildSettingsModal } from "@/components/BuildSettingsModal";
import { WorkItemsAdmin } from "@/components/WorkItemsAdmin";
import { primaryBtn } from "@/components/Modal";

const TABS = ["Board", "Epics", "Initiatives"] as const;
const SETTINGS_TABS = ["Analytics", "Stages & Flow", "All Work Items"] as const;
type Tab = (typeof TABS)[number] | (typeof SETTINGS_TABS)[number];

export default function EngineeringPage() {
  return (
    <Suspense fallback={null}>
      <EngineeringPageInner />
    </Suspense>
  );
}

function EngineeringPageInner() {
  const tickets = useTickets();
  const builds = useBuilds();
  const members = useMembers();
  const activeBuild = useUIStore((s) => s.activeBuild);
  const openWorkItem = useUIStore((s) => s.openWorkItem);
  const setOpenWorkItem = useUIStore((s) => s.setOpenWorkItem);
  const activeCard = useUIStore((s) => s.activeCard);
  const groupBy = useUIStore((s) => s.boardGroupBy);
  const setGroupBy = useUIStore((s) => s.setBoardGroupBy);
  const workBuildScope = useUIStore((s) => s.workBuildScope);
  const setWorkBuildScope = useUIStore((s) => s.setWorkBuildScope);
  const [issueOpen, setIssueOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Board");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buildSettingsOpen, setBuildSettingsOpen] = useState(false);
  // Settings/Templates scope independent of the top-nav build filter — defaults
  // to the global config (null) rather than silently inheriting whatever build
  // happens to be selected for the Board/Epics/Initiatives views.
  const [settingsBuildId, setSettingsBuildId] = useState<string | null>(null);
  // Shared item-type filter for the Stages & Flow tab — StagesEditor and
  // WorkflowRulesEditor used to each keep their own independent copy of this,
  // meaning a user had to set the same filter twice and the two editors could
  // disagree. Lifted here so there's exactly one control.
  const [settingsItemType, setSettingsItemType] = useState<ItemType>("ticket");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A lineage-link click stashes { type, key } on the UI store; jump to the
  // tab that owns that work item so its own effect can open the drawer.
  useEffect(() => {
    if (!openWorkItem) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local tab to an external Zustand signal set by a lineage-link click elsewhere in the tree
    if (openWorkItem.type === "ticket") setTab("Board");
    if (openWorkItem.type === "epic") setTab("Epics");
    if (openWorkItem.type === "initiative") setTab("Initiatives");
  }, [openWorkItem]);

  // On first load, a shareable ?card=type:key URL opens straight to that
  // item's drawer — the target board's own pickup effect does the rest.
  const consumedInitialCard = useRef(false);
  useEffect(() => {
    if (consumedInitialCard.current) return;
    consumedInitialCard.current = true;
    const card = searchParams.get("card");
    if (!card) return;
    const [type, ...rest] = card.split(":");
    const key = rest.join(":");
    if (key && (type === "ticket" || type === "epic" || type === "initiative")) {
      setOpenWorkItem({ type, key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror whichever drawer is open back into the URL so the card is
  // shareable/bookmarkable and agents can reference it directly.
  useEffect(() => {
    const next = activeCard ? `${activeCard.type}:${activeCard.key}` : null;
    if (next === searchParams.get("card")) return;
    const url = next ? `${pathname}?card=${encodeURIComponent(next)}` : pathname;
    router.replace(url, { scroll: false });
  }, [activeCard, pathname, router, searchParams]);

  const all = tickets.data ?? [];
  const open = all.filter((t) => t.stage !== "done" && t.stage !== "archived").length;
  const inProgress = all.filter((t) => t.stage === "in_progress").length;
  const done = all.filter((t) => t.stage === "done").length;
  const scopedTickets = workBuildScope === "all" ? all : all.filter((t) => t.build_id === workBuildScope);

  const hasBuilds = (builds.data?.length ?? 0) > 0;
  const boardId = activeBuild !== "all" ? activeBuild : (builds.data?.[0]?.id ?? "");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Open" value={open} />
        <MetricCard label="In Progress" value={inProgress} />
        <MetricCard label="Done" value={done} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-[var(--glass-border-2)] p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "rounded-md px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide " +
                (tab === t ? "bg-[var(--indigo)] text-white" : "text-[var(--muted-hi)] hover:text-[var(--white)]")
              }
            >
              {t === "Board" ? "Tickets" : t}
            </button>
          ))}
          <div className="relative">
            <button
              onClick={() => setSettingsOpen((o) => !o)}
              className={
                "rounded-md px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide " +
                ((SETTINGS_TABS as readonly string[]).includes(tab)
                  ? "bg-[var(--indigo)] text-white"
                  : "text-[var(--muted-hi)] hover:text-[var(--white)]")
              }
            >
              Settings ▾
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                <div className="absolute left-0 z-20 mt-1 min-w-[160px] rounded-md border border-[var(--glass-border-2)] bg-[var(--void-2)] py-1 shadow-lg">
                  {SETTINGS_TABS.map((t) => (
                    <button
                      key={t}
                      className="block w-full px-3 py-1.5 text-left text-sm text-[var(--muted-hi)] hover:bg-[var(--glass-border-2)] hover:text-[var(--white)]"
                      onClick={() => {
                        setTab(t);
                        setSettingsOpen(false);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                  <button
                    className="block w-full px-3 py-1.5 text-left text-sm text-[var(--muted-hi)] hover:bg-[var(--glass-border-2)] hover:text-[var(--white)]"
                    onClick={() => {
                      setBuildSettingsOpen(true);
                      setSettingsOpen(false);
                    }}
                  >
                    App details
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!hasBuilds ? (
        <EmptyState title="No builds yet" hint="Add a build from the Overview tab before creating issues." />
      ) : (
        <>
          {(tab === "Board" || tab === "Epics" || tab === "Initiatives") && (
            <div className="flex items-center justify-end gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--muted-hi)]">
                Group by
                <select
                  className="rounded-md border border-[var(--glass-border-2)] bg-[var(--void-2)] px-2 py-1 text-sm text-[var(--white)]"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
                >
                  {GROUP_BY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <BoardFilters />
              <label className="flex items-center gap-2 text-xs text-[var(--muted-hi)]">
                Scope
                <select
                  className="rounded-md border border-[var(--glass-border-2)] bg-[var(--void-2)] px-2 py-1 text-sm text-[var(--white)]"
                  value={workBuildScope === "all" ? "__all__" : (workBuildScope ?? "")}
                  onChange={(e) =>
                    setWorkBuildScope(e.target.value === "__all__" ? "all" : e.target.value || null)
                  }
                >
                  <option value="__all__">All Builds</option>
                  <option value="">Unassigned</option>
                  {(builds.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {tab === "Board" && (
            <section className="space-y-3">
              <div className="flex justify-end">
                <button className={primaryBtn} onClick={() => setIssueOpen(true)}>
                  + Ticket
                </button>
              </div>
              {scopedTickets.length === 0 ? (
                <EmptyState
                  title="No issues"
                  hint="Create one, then drag it to Done to watch the rules engine cascade (recompute health → notify → audit)."
                  action={
                    <button className={primaryBtn} onClick={() => setIssueOpen(true)}>
                      + Ticket
                    </button>
                  }
                />
              ) : (
                <Kanban tickets={scopedTickets} members={members.data ?? []} />
              )}
            </section>
          )}
          {tab === "Epics" && <EpicsBoard buildId={workBuildScope} />}
          {tab === "Initiatives" && <InitiativesBoard buildId={workBuildScope} />}
          {tab === "Analytics" && <EngineeringAnalytics tickets={all} />}
          {tab === "Stages & Flow" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-[var(--muted-hi)]">
                    Scope
                    <select
                      className="rounded-md border border-[var(--glass-border-2)] bg-[var(--void-2)] px-2 py-1 text-sm text-[var(--white)]"
                      value={settingsBuildId ?? ""}
                      onChange={(e) => setSettingsBuildId(e.target.value || null)}
                    >
                      <option value="">Global (all builds)</option>
                      {(builds.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} (override)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--muted-hi)]">
                    Item type
                    <select
                      className="rounded-md border border-[var(--glass-border-2)] bg-[var(--void-2)] px-2 py-1 text-sm text-[var(--white)]"
                      value={settingsItemType}
                      onChange={(e) => setSettingsItemType(e.target.value as ItemType)}
                    >
                      <option value="ticket">ticket</option>
                      <option value="epic">epic</option>
                      <option value="initiative">initiative</option>
                    </select>
                  </label>
                </div>
                <LoadTemplateButton buildId={settingsBuildId} />
              </div>
              <StagesEditor buildId={settingsBuildId} itemType={settingsItemType} />
              <SwimlanesEditor buildId={settingsBuildId} />
              <WorkflowRulesEditor buildId={settingsBuildId} itemType={settingsItemType} />
            </div>
          )}
          {tab === "All Work Items" && <WorkItemsAdmin />}
        </>
      )}

      <NewIssueModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        builds={builds.data ?? []}
        defaultBuild={activeBuild}
      />

      {buildSettingsOpen &&
        (() => {
          const build = builds.data?.find((b) => b.id === boardId);
          return build ? <BuildSettingsModal build={build} onClose={() => setBuildSettingsOpen(false)} /> : null;
        })()}
    </div>
  );
}
