"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Ephemeral UI state only (spec §10.2). Server data lives in TanStack Query,
 *  except for the fields listed in `partialize` below, which are persisted to
 *  localStorage so a user's board settings survive a page refresh.
 *  `activeBuild` = a build id, or "all" for the portfolio view. */
type UIState = {
  activeBuild: string; // build id | "all"
  setActiveBuild: (id: string) => void;
  approvalsOpen: boolean; // Approvals tray slide-over (spec §10.4)
  setApprovalsOpen: (open: boolean) => void;
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeBuild: "all",
      setActiveBuild: (id) => set({ activeBuild: id }),
      approvalsOpen: false,
      setApprovalsOpen: (open) => set({ approvalsOpen: open }),
    }),
    {
      name: "engineering-ui",
      partialize: (s) => ({
        activeBuild: s.activeBuild,
      }),
    },
  ),
);
