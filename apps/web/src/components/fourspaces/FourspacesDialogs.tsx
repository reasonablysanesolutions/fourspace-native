import { ImportWorkspaceDialog } from "./ImportWorkspaceDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { useFourspacesUiStore } from "../../fourspaces/fourspacesUiStore";

// Portal host for Four Spaces dialogs. Rendered once beside the app shell;
// the dialogs themselves read their open state from the UI store.
export function FourspacesDialogs() {
  const dialog = useFourspacesUiStore((state) => state.dialog);
  if (!dialog) return null;
  if (dialog.mode === "new") {
    return (
      <NewWorkspaceDialog
        key={`new:${dialog.space}:${dialog.originProductId ?? ""}`}
        initialSpace={dialog.space}
        originProductId={dialog.originProductId ?? null}
      />
    );
  }
  return <ImportWorkspaceDialog key={`${dialog.mode}:${dialog.space}`} />;
}
