import { create } from "zustand";

import type { FourSpaceWorkspaceId } from "./spaces";

export type FourspacesDialogMode = "import" | "organize";

interface FourspacesDialogRequest {
  readonly mode: FourspacesDialogMode;
  readonly space: FourSpaceWorkspaceId;
}

interface FourspacesUiState {
  readonly dialog: FourspacesDialogRequest | null;
  openImportDialog: (space: FourSpaceWorkspaceId) => void;
  openOrganizeDialog: (space: FourSpaceWorkspaceId) => void;
  closeDialog: () => void;
}

// Session-only: which dialog is open never persists. The organize prompt
// "shown" flag lives in the persisted nav store instead.
export const useFourspacesUiStore = create<FourspacesUiState>()((set) => ({
  dialog: null,
  openImportDialog: (space) => set({ dialog: { mode: "import", space } }),
  openOrganizeDialog: (space) => set({ dialog: { mode: "organize", space } }),
  closeDialog: () => set({ dialog: null }),
}));

// Dev-only handle for smoke tests (reads real dialog state, no reloads).
if (import.meta.env.DEV) {
  (window as unknown as { __fourspacesUiStore?: typeof useFourspacesUiStore }).__fourspacesUiStore =
    useFourspacesUiStore;
}
