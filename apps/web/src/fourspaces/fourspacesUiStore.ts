import { create } from "zustand";
import type { EnvironmentId } from "@t3tools/contracts";

import type { FourSpaceWorkspaceId } from "./spaces";

export type FourspacesDialogMode = "import" | "organize" | "new" | "notes" | "product";

/** Workspace target for the notes dialog. */
export interface NotesProject {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly cwd: string;
  readonly title: string;
}

interface FourspacesDialogRequest {
  readonly mode: FourspacesDialogMode;
  readonly space: FourSpaceWorkspaceId;
  /** Owning product for experiments created from a product (FAS 8 wires the entry point). */
  readonly originProductId?: string | null;
  /** Notes target (only for mode "notes"). */
  readonly notesProject?: NotesProject | null;
}

interface FourspacesUiState {
  readonly dialog: FourspacesDialogRequest | null;
  /** Session-only roots proven missing: never re-adopt them as Chat backing. */
  readonly deadChatRootsByEnvironment: Record<string, ReadonlyArray<string>>;
  openImportDialog: (space: FourSpaceWorkspaceId) => void;
  openOrganizeDialog: (space: FourSpaceWorkspaceId) => void;
  openNewDialog: (space: FourSpaceWorkspaceId, originProductId?: string | null) => void;
  openNotesDialog: (space: FourSpaceWorkspaceId, project: NotesProject) => void;
  openProductDialog: (space: FourSpaceWorkspaceId, project: NotesProject) => void;
  markChatRootDead: (environmentId: EnvironmentId, root: string) => void;
  closeDialog: () => void;
}

// Session-only: which dialog is open never persists. The organize prompt
// "shown" flag lives in the persisted nav store instead.
export const useFourspacesUiStore = create<FourspacesUiState>()((set) => ({
  dialog: null,
  deadChatRootsByEnvironment: {},
  openImportDialog: (space) => set({ dialog: { mode: "import", space } }),
  openOrganizeDialog: (space) => set({ dialog: { mode: "organize", space } }),
  openNewDialog: (space, originProductId) =>
    set({ dialog: { mode: "new", space, originProductId: originProductId ?? null } }),
  openNotesDialog: (space, project) =>
    set({ dialog: { mode: "notes", space, notesProject: project } }),
  openProductDialog: (space, project) =>
    set({ dialog: { mode: "product", space, notesProject: project } }),
  markChatRootDead: (environmentId, root) =>
    set((state) => {
      const current = state.deadChatRootsByEnvironment[environmentId] ?? [];
      if (current.includes(root)) return {};
      return {
        deadChatRootsByEnvironment: {
          ...state.deadChatRootsByEnvironment,
          [environmentId]: [...current, root],
        },
      };
    }),
  closeDialog: () => set({ dialog: null }),
}));

// Dev-only handle for smoke tests (reads real dialog state, no reloads).
if (import.meta.env.DEV) {
  (window as unknown as { __fourspacesUiStore?: typeof useFourspacesUiStore }).__fourspacesUiStore =
    useFourspacesUiStore;
}
