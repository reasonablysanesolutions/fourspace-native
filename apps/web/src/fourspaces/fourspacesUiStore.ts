import { create } from "zustand";

import type { FourSpaceWorkspaceId } from "./spaces";

export type FourspacesDialogMode = "import" | "organize" | "new";

interface FourspacesDialogRequest {
  readonly mode: FourspacesDialogMode;
  readonly space: FourSpaceWorkspaceId;
  /** Owning product for experiments created from a product (FAS 8 wires the entry point). */
  readonly originProductId?: string | null;
}

interface FourspacesUiState {
  readonly dialog: FourspacesDialogRequest | null;
  openImportDialog: (space: FourSpaceWorkspaceId) => void;
  openOrganizeDialog: (space: FourSpaceWorkspaceId) => void;
  openNewDialog: (space: FourSpaceWorkspaceId, originProductId?: string | null) => void;
  closeDialog: () => void;
}

// Session-only: which dialog is open never persists. The organize prompt
// "shown" flag lives in the persisted nav store instead.
export const useFourspacesUiStore = create<FourspacesUiState>()((set) => ({
  dialog: null,
  openImportDialog: (space) => set({ dialog: { mode: "import", space } }),
  openOrganizeDialog: (space) => set({ dialog: { mode: "organize", space } }),
  openNewDialog: (space, originProductId) =>
    set({ dialog: { mode: "new", space, originProductId: originProductId ?? null } }),
  closeDialog: () => set({ dialog: null }),
}));

// Dev-only handle for smoke tests (reads real dialog state, no reloads).
if (import.meta.env.DEV) {
  (window as unknown as { __fourspacesUiStore?: typeof useFourspacesUiStore }).__fourspacesUiStore =
    useFourspacesUiStore;
}
