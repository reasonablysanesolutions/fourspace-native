import { ImportWorkspaceDialog } from "./ImportWorkspaceDialog";
import { useFourspacesUiStore } from "../../fourspaces/fourspacesUiStore";

// Portal host for Four Spaces dialogs. Rendered once beside the app shell;
// the dialogs themselves read their open state from the UI store.
export function FourspacesDialogs() {
  const dialog = useFourspacesUiStore((state) => state.dialog);
  if (!dialog) return null;
  return <ImportWorkspaceDialog key={`${dialog.mode}:${dialog.space}`} />;
}
