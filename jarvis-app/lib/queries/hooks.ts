"use client";

import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useUIStore } from "@/lib/store";
import type { Tables } from "@/lib/database.types";

// One browser client for the module (createBrowserClient is a singleton-friendly).
const supabase = createClient();

/** Subscribe to Postgres CDC on a table and invalidate a query key on change.
 *  Drives the spec's <1s live updates without manual refresh. */
export function useRealtime(table: string, queryKey: unknown[]) {
  const qc = useQueryClient();
  // Per-instance suffix: supabase.channel() dedupes by topic and returns an
  // already-subscribed channel, so two components subscribing to the same
  // (table, queryKey) would collide — the 2nd .on() throws "cannot add
  // postgres_changes callbacks after subscribe()". useId keeps topics unique.
  const subscriberId = useId();
  useEffect(() => {
    const channel = supabase
      .channel(`rt:${table}:${JSON.stringify(queryKey)}:${subscriberId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, JSON.stringify(queryKey), subscriberId]);
}

/** Apply the active-build scope (Zustand) to a query. "all" = no filter. */
function scoped<T extends { eq: (col: string, val: string) => T }>(
  q: T,
  activeBuild: string,
  col = "build_id",
): T {
  return activeBuild === "all" ? q : q.eq(col, activeBuild);
}

export function useBuilds() {
  const key = ["builds"];
  useRealtime("builds", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("builds")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Tables<"builds">[];
    },
  });
}

/** All builds regardless of active status — used to resolve names for rows (e.g. templates) tied to a deactivated build. */
export function useAllBuilds() {
  const key = ["builds", "all"];
  useRealtime("builds", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("builds").select("*").order("sort_order");
      if (error) throw error;
      return data as Tables<"builds">[];
    },
  });
}

export function useTickets() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["tickets", activeBuild];
  useRealtime("tickets", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("tickets").select("*").order("stage_changed_at", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"tickets">[];
    },
  });
}

export function useActionLog(limit = 50) {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["action_log", activeBuild, limit];
  useRealtime("action_log", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("action_log").select("*").order("created_at", { ascending: false }).limit(limit),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"action_log">[];
    },
  });
}

export function useEvents(limit = 50) {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["events", activeBuild, limit];
  useRealtime("events", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("events").select("*").order("created_at", { ascending: false }).limit(limit),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"events">[];
    },
  });
}

export function useExpenses() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["expenses", activeBuild];
  useRealtime("expenses", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("expenses").select("*").order("spent_on", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"expenses">[];
    },
  });
}

export function useRevenue() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["revenue_entries", activeBuild];
  useRealtime("revenue_entries", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("revenue_entries").select("*").order("occurred_on", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"revenue_entries">[];
    },
  });
}

/** Personal / owner contributions into the business (capital, loans, personally
 *  paid expenses). Build-scoped like expenses; null build_id = studio/overhead. */
export function useContributions() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["contributions", activeBuild];
  useRealtime("contributions", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("contributions").select("*").order("contributed_on", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"contributions">[];
    },
  });
}

/** Active roster — used to attribute a contribution to a member. Never scoped. */
export function useMembers() {
  const key = ["members"];
  useRealtime("members", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data as Tables<"members">[];
    },
  });
}

export function useProspects() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["prospects", activeBuild];
  useRealtime("prospects", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("prospects").select("*").order("updated_at", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"prospects">[];
    },
  });
}

export function useFeedback() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["feedback", activeBuild];
  useRealtime("feedback", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("feedback").select("*").order("created_at", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"feedback">[];
    },
  });
}

export function useApprovals() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["approvals", activeBuild];
  useRealtime("approvals", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase
          .from("approvals")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"approvals">[];
    },
  });
}

/** Pending approvals across ALL builds — never scoped by activeBuild. The
 *  top-bar bell is an always-on signal; a gate on a non-active build must
 *  still surface (spec §10.1/§10.4). TriageInbox uses the scoped useApprovals;
 *  the bell/tray use this. */
export function usePendingApprovals() {
  const key = ["approvals", "pending"];
  useRealtime("approvals", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvals")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"approvals">[];
    },
  });
}

/** Latest portfolio cash-on-hand (cents) from the bank sync's `cash`
 *  metric_snapshot, or null when no bank is connected (→ bootstrapped runway).
 *  Cash is studio-level (build_id null), so this is never build-scoped. */
export function useCashOnHand() {
  const key = ["metric_snapshots", "cash"];
  useRealtime("metric_snapshots", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metric_snapshots")
        .select("value_num")
        .eq("metric", "cash")
        .is("build_id", null)
        .order("captured_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.value_num) : null;
    },
  });
}

/** Latest value of each named portfolio metric, keyed by metric name. Absent
 *  metrics are simply missing from the map — the caller renders "—" rather than
 *  a zero, because "no bank connected" and "$0 in the bank" are different facts.
 *
 *  One query for all the metrics FinOps needs, rather than a hook per card. */
export function useLatestMetrics(metrics: string[]) {
  const key = ["metric_snapshots", "latest", [...metrics].sort()];
  useRealtime("metric_snapshots", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metric_snapshots")
        .select("metric, value_num, captured_on, meta")
        .in("metric", metrics)
        .is("build_id", null)
        .order("captured_on", { ascending: false });
      if (error) throw error;
      // Rows arrive newest-first, so the first sighting of a metric wins.
      const latest = new Map<string, { value: number; captured_on: string; meta: unknown }>();
      for (const row of data ?? []) {
        if (!latest.has(row.metric)) {
          latest.set(row.metric, {
            value: Number(row.value_num),
            captured_on: row.captured_on,
            meta: row.meta,
          });
        }
      }
      return latest;
    },
  });
}

/** Daily history of the named portfolio metrics over the trailing `days`,
 *  oldest-first — the shape a chart wants. */
export function useMetricSeries(metrics: string[], days = 90) {
  const key = ["metric_snapshots", "series", [...metrics].sort(), days];
  useRealtime("metric_snapshots", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("metric_snapshots")
        .select("metric, value_num, captured_on")
        .in("metric", metrics)
        .is("build_id", null)
        .gte("captured_on", since)
        .order("captured_on", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        metric: r.metric as string,
        value: Number(r.value_num),
        captured_on: r.captured_on as string,
      }));
    },
  });
}

export function useAgents() {
  const key = ["agents"];
  useRealtime("agents", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("*").order("name");
      if (error) throw error;
      return data as Tables<"agents">[];
    },
  });
}

/** Recent agent runs (fleet history). Joined to agent name/slug in the page via
 *  useAgents; kept flat here so the generated FK types stay simple. */
export function useAgentRuns(limit = 20) {
  const key = ["agent_runs", limit];
  useRealtime("agent_runs", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as Tables<"agent_runs">[];
    },
  });
}

export function useConnections() {
  const key = ["connections"];
  useRealtime("connections", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("connections").select("*").order("display_name");
      if (error) throw error;
      return data as Tables<"connections">[];
    },
  });
}

export function useMilestones() {
  const key = ["milestones"];
  useRealtime("milestones", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("milestones").select("*").order("sort_order");
      if (error) throw error;
      return data as Tables<"milestones">[];
    },
  });
}

/** Recent commits + PRs per build (GitHub adapter feed). Never build-scoped —
 *  the Overview matrix groups by build itself. Dark until GitHub is connected. */
export function useRepoActivity(limit = 60) {
  const key = ["repo_activity", limit];
  useRealtime("repo_activity", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repo_activity")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as Tables<"repo_activity">[];
    },
  });
}

/** Commits/PRs whose branch, commit message, or PR title referenced this
 *  ticket's key (e.g. "BD-0005"), parsed by the github adapter. */
export function useLinkedActivity(ticketKey: string | null | undefined) {
  const key = ["repo_activity", "ticket_key", ticketKey];
  useRealtime("repo_activity", key);
  return useQuery({
    queryKey: key,
    enabled: Boolean(ticketKey),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repo_activity")
        .select("*")
        .eq("ticket_key", ticketKey as string)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"repo_activity">[];
    },
  });
}

/** Open, non-draft PRs across every repo in the org (GitHub adapter feed).
 *  Never build-scoped — Needs Attention shows everything. */
export function useOpenPRs() {
  const key = ["github_open_prs"];
  useRealtime("github_open_prs", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("github_open_prs")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"github_open_prs">[];
    },
  });
}

export type GithubRepo = {
  full_name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  pushed_at: string | null;
};

/** The org's real GitHub repos (via the connected token) for linking/importing
 *  builds. Lazy: only fetched when `enabled` (a picker is open), and cached so a
 *  re-open doesn't re-hit GitHub. Returns [] when GitHub isn't connected. */
export function useGithubRepos(enabled: boolean) {
  return useQuery({
    queryKey: ["github_repos"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("github", { body: { list_repos: true } });
      if (error) throw error;
      return (data?.repos ?? []) as GithubRepo[];
    },
  });
}

/** The signed-in member's own roster row — used to optimistically self-assign
 *  a ticket the instant it's moved, before the RPC round-trip confirms it. */
export function useCurrentMember() {
  const members = useMembers();
  const key = ["auth", "current-member"];
  return useQuery({
    queryKey: key,
    enabled: !!members.data,
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      return members.data?.find((m) => m.id === uid) ?? null;
    },
  });
}

export function useInitiatives() {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const key = ["initiatives", activeBuild];
  useRealtime("initiatives", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("initiatives").select("*").order("sort_order"),
        activeBuild,
      );
      if (error) throw error;
      return data as Tables<"initiatives">[];
    },
  });
}

/** Pass buildId to pin the scope to a specific build regardless of the global
 *  build filter — needed by drawers editing a work item that may not belong
 *  to whichever build the board picker currently has selected. */
export function useEpics(buildId?: string) {
  const activeBuild = useUIStore((s) => s.activeBuild);
  const scope = buildId ?? activeBuild;
  const key = ["epics", scope];
  useRealtime("epics", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await scoped(
        supabase.from("epics").select("*").order("sort_order"),
        scope,
      );
      if (error) throw error;
      return data as Tables<"epics">[];
    },
  });
}

/** Custom-field templates. build_id null = global fallback for that item_type. */
export function useTemplates() {
  const key = ["work_item_templates"];
  useRealtime("work_item_templates", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("work_item_templates").select("*");
      if (error) throw error;
      return data as Tables<"work_item_templates">[];
    },
  });
}

/** Loadable stage/rule/WIP/field-requirement playbooks — a library, not scoped to any build. */
export function useWorkflowTemplates() {
  const key = ["workflow_templates"];
  useRealtime("workflow_templates", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_templates").select("*").order("name");
      if (error) throw error;
      return data as Tables<"workflow_templates">[];
    },
  });
}

/** Allowed stage transitions (+ optional gating conditions) per build/item_type. build_id null = global fallback. */
export function useWorkflowStageRules() {
  const key = ["workflow_stage_rules"];
  useRealtime("workflow_stage_rules", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_stage_rules").select("*");
      if (error) throw error;
      return data as Tables<"workflow_stage_rules">[];
    },
  });
}

export function useWorkflowStages() {
  const key = ["workflow_stages"];
  useRealtime("workflow_stages", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_stages").select("*").order("sort_order");
      if (error) throw error;
      return data as Tables<"workflow_stages">[];
    },
  });
}

/** Aggregate WIP limits spanning multiple stages, per build/item_type. build_id null = global fallback. */
export function useWorkflowWipGroups() {
  const key = ["workflow_wip_groups"];
  useRealtime("workflow_wip_groups", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_wip_groups").select("*");
      if (error) throw error;
      return data as Tables<"workflow_wip_groups">[];
    },
  });
}

/** "Field X required to enter/exit stage Y" movement rules, per build/item_type. */
export function useWorkflowFieldRequirements() {
  const key = ["workflow_field_requirements"];
  useRealtime("workflow_field_requirements", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_field_requirements").select("*");
      if (error) throw error;
      return data as Tables<"workflow_field_requirements">[];
    },
  });
}

/** Configurable swimlanes per build. build_id null = global fallback. */
export function useWorkflowSwimlanes() {
  const key = ["workflow_swimlanes"];
  useRealtime("workflow_swimlanes", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("workflow_swimlanes").select("*").order("sort_order");
      if (error) throw error;
      return data as Tables<"workflow_swimlanes">[];
    },
  });
}

/** Saved board filter presets (spec: custom filters dropdown). */
export function useBoardFilters() {
  const key = ["board_filters"];
  useRealtime("board_filters", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("board_filters").select("*").order("created_at");
      if (error) throw error;
      return data as Tables<"board_filters">[];
    },
  });
}

export function useRules() {
  const key = ["rules"];
  useRealtime("rules", key);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("rules").select("*").order("priority");
      if (error) throw error;
      return data as Tables<"rules">[];
    },
  });
}

export { supabase };
