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
