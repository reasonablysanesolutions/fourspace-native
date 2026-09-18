// Product overview dialog: a calm home view for a long-lived product —
// summary counts, related experiments, and the way back in. Full workspace
// tabs arrive later; this dialog carries the FAS 8 essentials (overview,
// related experiments, New Experiment) without new routes.
import { selectRelatedExperiments } from "@t3tools/client-runtime/fourspaces/product-context";
import { findWorkspaceEntry } from "@t3tools/client-runtime/fourspaces/registry";
import type { FourSpaceWorkspaceId } from "../../fourspaces/spaces";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  selectEnvironmentRegistry,
  useFourspacesRegistryStore,
} from "../../fourspaces/fourspacesRegistryStore";
import { useFourspacesUiStore, type NotesProject } from "../../fourspaces/fourspacesUiStore";
import { useProjects, useThreadShells } from "../../state/entities";

export function ProductDialog({
  project,
  space,
}: {
  project: NotesProject;
  space: FourSpaceWorkspaceId;
}) {
  const closeDialog = useFourspacesUiStore((state) => state.closeDialog);
  const openNewDialog = useFourspacesUiStore((state) => state.openNewDialog);
  const openNotesDialog = useFourspacesUiStore((state) => state.openNotesDialog);
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useThreadShells();
  const registryStore = useFourspacesRegistryStore();
  const registryState = selectEnvironmentRegistry(registryStore, project.environmentId);

  const entry = findWorkspaceEntry(registryState, {
    id: project.projectId,
    workspaceRoot: project.cwd,
  });
  const related = entry ? selectRelatedExperiments(registryState, entry.workspaceId) : [];
  const projectThreads = threads.filter(
    (thread) =>
      thread.environmentId === project.environmentId && thread.projectId === project.projectId,
  );

  const openExperiment = (experiment: { projectId: string | null; workspaceRoot: string }) => {
    const candidate = experiment.projectId
      ? projects.find((item) => item.id === experiment.projectId)
      : projects.find((item) => item.workspaceRoot === experiment.workspaceRoot);
    const latest = candidate
      ? threads
          .filter(
            (thread) =>
              thread.environmentId === candidate.environmentId && thread.projectId === candidate.id,
          )
          .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      : undefined;
    closeDialog();
    if (latest) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(latest.environmentId, latest.id)),
      });
    } else {
      void navigate({ to: "/" });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project.title}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{project.cwd}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col gap-5">
          <p className="text-[13px] text-muted-foreground">
            {related.length === 0
              ? "No related experiments yet."
              : `${related.length} related experiment${related.length === 1 ? "" : "s"} · ${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}`}
          </p>
          {related.length > 0 ? (
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
              <h3 className="text-[13px] font-medium text-foreground">Related experiments</h3>
              {related.map((experiment) => {
                const record = experiment.projectId
                  ? projects.find((item) => item.id === experiment.projectId)
                  : projects.find((item) => item.workspaceRoot === experiment.workspaceRoot);
                return (
                  <button
                    className="cursor-pointer rounded-lg border border-border/70 px-3 py-2 text-left hover:bg-card/60"
                    key={experiment.workspaceId}
                    onClick={() => openExperiment(experiment)}
                    type="button"
                  >
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {record?.title ?? experiment.workspaceId}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {experiment.workspaceRoot}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (entry) openNewDialog("experiment", entry.workspaceId);
              }}
              size="sm"
              type="button"
              disabled={!entry}
            >
              New Experiment
            </Button>
            <Button
              onClick={() => openNotesDialog(space, project)}
              size="sm"
              type="button"
              variant="outline"
            >
              Notes
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
