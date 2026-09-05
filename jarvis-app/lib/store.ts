"use client";

import { create } from "zustand";

/** Ephemeral UI state only (spec §10.2). Server data lives in TanStack Query.
 *  `activeBuild` = a build id, or "all" for the portfolio view. */
type UIState = {
  activeBuild: string; // build id | "all"
  setActiveBuild: (id: string) => void;
  approvalsOpen: boolean; // Approvals tray slide-over (spec §10.4)
  setApprovalsOpen: (open: boolean) => void;
  activeTicketFilterIds: string[]; // board_filters.id[] currently applied to the ticket board
  setActiveTicketFilterIds: (ids: string[]) => void;
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

export const useUIStore = create<UIState>((set) => ({
  activeBuild: "all",
  setActiveBuild: (id) => set({ activeBuild: id }),
  approvalsOpen: false,
  setApprovalsOpen: (open) => set({ approvalsOpen: open }),
  activeTicketFilterIds: [],
  setActiveTicketFilterIds: (ids) => set({ activeTicketFilterIds: ids }),
  openWorkItem: null,
  setOpenWorkItem: (item) => set({ openWorkItem: item }),
  activeCard: null,
  setActiveCard: (item) => set({ activeCard: item }),
}));
