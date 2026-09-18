// Four Spaces notes dialog: a calm editor over the workspace NOTES.md.
// Apple Notes, not Notion — markdown text, autosave, nothing else.
import { NOTES_FILENAME } from "@t3tools/client-runtime/fourspaces/notes";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useWorkspaceNotes } from "../../fourspaces/useWorkspaceNotes";
import { useFourspacesUiStore, type NotesProject } from "../../fourspaces/fourspacesUiStore";

function statusLabel(status: ReturnType<typeof useWorkspaceNotes>["status"]): string {
  switch (status.kind) {
    case "loading":
      return "Loading…";
    case "saving":
      return "Saving…";
    case "edited":
      return "Edited";
    case "missing":
      return "New file — saved on first edit";
    case "error":
      return status.message;
    case "ready":
      return status.savedAt
        ? `Saved ${new Date(status.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Saved";
  }
}

export function NotesDialog({ project }: { project: NotesProject }) {
  const closeDialog = useFourspacesUiStore((state) => state.closeDialog);
  const notes = useWorkspaceNotes({
    environmentId: project.environmentId,
    cwd: project.cwd,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "notes" });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notes — {project.title}</DialogTitle>
          <DialogDescription>
            Lives in {NOTES_FILENAME} in the workspace. Agents can read it directly.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          {notes.status.kind === "error" && notes.text === "" ? (
            <div className="flex min-h-48 flex-col items-start justify-center gap-2 py-8">
              <p className="text-[13px] text-destructive" role="alert">
                {notes.status.message}
              </p>
              <Button onClick={notes.retry} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : (
            <textarea
              aria-label={`Notes for ${project.title}`}
              className="min-h-[40vh] w-full flex-1 resize-y rounded-lg border border-border/70 bg-card/40 p-4 text-[13px] leading-relaxed outline-hidden placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
              disabled={notes.status.kind === "loading"}
              onChange={(event) => notes.setText(event.currentTarget.value)}
              placeholder={"# Notes\n\nThings worth remembering…"}
              value={notes.text}
            />
          )}
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground" role="status">
              {statusLabel(notes.status)}
            </span>
            <Button
              onClick={() => copyToClipboard(notes.text)}
              size="sm"
              type="button"
              variant="outline"
              disabled={notes.text.length === 0}
            >
              {isCopied ? "Copied" : "Copy"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
