"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GroupByOption } from "@/lib/board-constants";

/** Ephemeral UI state only (spec §10.2). Server data lives in TanStack Query,
 *  except for the fields listed in `partialize` below, which are persisted to
 *  localStorage so a user's board settings survive a page refresh.
 *  `activeBuild` = a build id, or "all" for the portfolio view. */
type UIState = {
  activeBuild: string; // build id | "all"
  setActiveBuild: (id: string) => void;
  approvalsOpen: boolean; // Approvals tray slide-over (spec §10.4)
  setApprovalsOpen: (open: boolean) => void;
  activeTicketFilterIds: string[]; // board_filters.id[] currently applied to the ticket board
  setActiveTicketFilterIds: (ids: string[]) => void;
  // Shared "Group by" choice for the Board/Epics/Initiatives tabs — lives here
  // (rather than component state) so it persists across tab switches instead
  // of resetting each time Kanban/EpicsBoard/InitiativesBoard remounts.
  boardGroupBy: GroupByOption;
  setBoardGroupBy: (v: GroupByOption) => void;
  // Board/Epics/Initiatives scope selector — a build id, "all" (every build),
  // or null (buildless/"Unassigned" items only).
  workBuildScope: string | null | "all";
  setWorkBuildScope: (v: string | null | "all") => void;
  // A lineage/reference link click (or an incoming shareable URL) stashes
  // what to open here, keyed by the item's human-readable key (e.g.
  // "ENG-42") rather than its id, since that's what's URL- and
  // agent-referenceable. The target tab/board picks it up, opens the
  // matching drawer, then clears it.
  openWorkItem: { type: "ticket" | "epic" | "initiative"; key: string } | null;
  setOpenWorkItem: (item: { type: "ticket" | "epic" | "initiative"; key: string } | null) => void;
  // Mirrors whichever drawer is currently open, so the page can reflect it
  // in the URL (?card=type:key) for sharing/deep-linking. Null when closed.
  activeCard: { type: "ticket" | "epic" | "initiative"; key: string } | null;
  setActiveCard: (item: { type: "ticket" | "epic" | "initiative"; key: string } | null) => void;
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeBuild: "all",
      setActiveBuild: (id) => set({ activeBuild: id }),
      approvalsOpen: false,
      setApprovalsOpen: (open) => set({ approvalsOpen: open }),
      activeTicketFilterIds: [],
      setActiveTicketFilterIds: (ids) => set({ activeTicketFilterIds: ids }),
      boardGroupBy: "swimlane",
      setBoardGroupBy: (v) => set({ boardGroupBy: v }),
      workBuildScope: "all",
      setWorkBuildScope: (v) => set({ workBuildScope: v }),
      openWorkItem: null,
      setOpenWorkItem: (item) => set({ openWorkItem: item }),
      activeCard: null,
      setActiveCard: (item) => set({ activeCard: item }),
    }),
    {
      name: "engineering-ui",
      partialize: (s) => ({
        activeBuild: s.activeBuild,
        boardGroupBy: s.boardGroupBy,
        workBuildScope: s.workBuildScope,
      }),
    },
  ),
);
