import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import { isFourSpaceWorkspaceId, type FourSpaceWorkspaceId } from "./spaces";

interface FourspacesNavState {
  activeWorkspaceSpace: FourSpaceWorkspaceId;
  setActiveWorkspaceSpace: (space: FourSpaceWorkspaceId) => void;
  /** First-run organize prompt already offered per environment (fires once ever). */
  organizePromptShownByEnvironment: Record<string, true>;
  markOrganizePromptShown: (environmentId: EnvironmentId) => void;
}

export const useFourspacesNavStore = create<FourspacesNavState>()(
  persist(
    (set) => ({
      activeWorkspaceSpace: "chat",
      setActiveWorkspaceSpace: (space) => set({ activeWorkspaceSpace: space }),
      organizePromptShownByEnvironment: {},
      markOrganizePromptShown: (environmentId) =>
        set((state) => ({
          organizePromptShownByEnvironment: {
            ...state.organizePromptShownByEnvironment,
            [environmentId]: true as const,
          },
        })),
    }),
    {
      name: "t3code:fourspaces-nav:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        activeWorkspaceSpace: state.activeWorkspaceSpace,
        organizePromptShownByEnvironment: state.organizePromptShownByEnvironment,
      }),
    },
  ),
);

// Stored state predates validation, so sanitize at the read edge instead of
// trusting the persisted value.
export function selectActiveWorkspaceSpace(state: FourspacesNavState): FourSpaceWorkspaceId {
  return isFourSpaceWorkspaceId(state.activeWorkspaceSpace) ? state.activeWorkspaceSpace : "chat";
}
