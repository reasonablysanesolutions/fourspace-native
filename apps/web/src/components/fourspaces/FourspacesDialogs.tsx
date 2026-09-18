import { ImportWorkspaceDialog } from "./ImportWorkspaceDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { NotesDialog } from "./NotesDialog";
import { ProductDialog } from "./ProductDialog";
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
  if (dialog.mode === "notes") {
    if (!dialog.notesProject) return null;
    const notesProject = dialog.notesProject;
    return (
      <NotesDialog
        key={`notes:${notesProject.environmentId}:${notesProject.projectId}`}
        project={notesProject}
      />
    );
  }
  if (dialog.mode === "product") {
    if (!dialog.notesProject) return null;
    const productProject = dialog.notesProject;
    return (
      <ProductDialog
        key={`product:${productProject.environmentId}:${productProject.projectId}`}
        project={productProject}
        space={dialog.space}
      />
    );
  }
  return <ImportWorkspaceDialog key={`${dialog.mode}:${dialog.space}`} />;
}
