import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import { isFourSpaceWorkspaceId, type FourSpaceWorkspaceId } from "./spaces";

interface FourspacesNavState {
  activeWorkspaceSpace: FourSpaceWorkspaceId;
  setActiveWorkspaceSpace: (space: FourSpaceWorkspaceId) => void;
}

export const useFourspacesNavStore = create<FourspacesNavState>()(
  persist(
    (set) => ({
      activeWorkspaceSpace: "chat",
      setActiveWorkspaceSpace: (space) => set({ activeWorkspaceSpace: space }),
    }),
    {
      name: "t3code:fourspaces-nav:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ activeWorkspaceSpace: state.activeWorkspaceSpace }),
    },
  ),
);

// Stored state predates validation, so sanitize at the read edge instead of
// trusting the persisted value.
export function selectActiveWorkspaceSpace(state: FourspacesNavState): FourSpaceWorkspaceId {
  return isFourSpaceWorkspaceId(state.activeWorkspaceSpace) ? state.activeWorkspaceSpace : "chat";
}
