import type { EnvironmentId } from "@t3tools/contracts";
import {
  readEnvironmentState,
  removeWorkspaceEntriesForProject,
  removeWorkspaceEntry,
  sanitizeRegistry,
  setChatProjectId as applyChatProjectId,
  setDefaultRoot as applyDefaultRoot,
  upsertWorkspaceEntry,
  type FourSpacesEnvironmentState,
  type FourSpacesRegistry,
  type FourSpacesWorkspaceEntry,
} from "@t3tools/client-runtime/fourspaces/registry";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";

interface FourspacesRegistryState {
  registriesByEnvironment: FourSpacesRegistry;
  upsertWorkspaceEntry: (environmentId: EnvironmentId, entry: FourSpacesWorkspaceEntry) => void;
  removeWorkspaceEntry: (environmentId: EnvironmentId, workspaceId: string) => void;
  removeWorkspaceEntriesForProject: (environmentId: EnvironmentId, projectId: string) => void;
  setChatProjectId: (environmentId: EnvironmentId, projectId: string | null) => void;
  setDefaultRoot: (environmentId: EnvironmentId, root: string | null) => void;
}

function updateEnvironmentState(
  state: FourspacesRegistryState,
  environmentId: EnvironmentId,
  update: (current: FourSpacesEnvironmentState) => FourSpacesEnvironmentState,
): Partial<FourspacesRegistryState> {
  const current = readEnvironmentState(state.registriesByEnvironment, environmentId);
  const next = update(current);
  if (next === current) return {};
  return {
    registriesByEnvironment: { ...state.registriesByEnvironment, [environmentId]: next },
  };
}

export const useFourspacesRegistryStore = create<FourspacesRegistryState>()(
  persist(
    (set) => ({
      registriesByEnvironment: {},
      upsertWorkspaceEntry: (environmentId, entry) =>
        set((state) =>
          updateEnvironmentState(state, environmentId, (current) =>
            upsertWorkspaceEntry(current, entry),
          ),
        ),
      removeWorkspaceEntry: (environmentId, workspaceId) =>
        set((state) =>
          updateEnvironmentState(state, environmentId, (current) =>
            removeWorkspaceEntry(current, workspaceId),
          ),
        ),
      removeWorkspaceEntriesForProject: (environmentId, projectId) =>
        set((state) =>
          updateEnvironmentState(state, environmentId, (current) =>
            removeWorkspaceEntriesForProject(current, projectId),
          ),
        ),
      setChatProjectId: (environmentId, projectId) =>
        set((state) =>
          updateEnvironmentState(state, environmentId, (current) =>
            applyChatProjectId(current, projectId),
          ),
        ),
      setDefaultRoot: (environmentId, root) =>
        set((state) =>
          updateEnvironmentState(state, environmentId, (current) =>
            applyDefaultRoot(current, root),
          ),
        ),
    }),
    {
      name: "t3code:fourspaces-registry:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ registriesByEnvironment: state.registriesByEnvironment }),
    },
  ),
);

// Stored state predates validation, so sanitize at the read edge.
export function selectEnvironmentRegistry(
  state: FourspacesRegistryState,
  environmentId: EnvironmentId,
): FourSpacesEnvironmentState {
  return readEnvironmentState(sanitizeRegistry(state.registriesByEnvironment), environmentId);
}

// Dev-only handle for smoke tests and debugging (drives the real store, no
// reload needed). Never used in production builds.
if (import.meta.env.DEV) {
  (
    window as unknown as { __fourspacesRegistryStore?: typeof useFourspacesRegistryStore }
  ).__fourspacesRegistryStore = useFourspacesRegistryStore;
}
