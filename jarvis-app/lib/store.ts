"use client";

import { create } from "zustand";

/** Ephemeral UI state only (spec §10.2). Server data lives in TanStack Query.
 *  `activeBuild` = a build id, or "all" for the portfolio view. */
type UIState = {
  activeBuild: string; // build id | "all"
  setActiveBuild: (id: string) => void;
  approvalsOpen: boolean; // Approvals tray slide-over (spec §10.4)
  setApprovalsOpen: (open: boolean) => void;
};

export const useUIStore = create<UIState>((set) => ({
  activeBuild: "all",
  setActiveBuild: (id) => set({ activeBuild: id }),
  approvalsOpen: false,
  setApprovalsOpen: (open) => set({ approvalsOpen: open }),
}));
