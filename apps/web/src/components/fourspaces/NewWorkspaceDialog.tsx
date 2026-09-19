// Four Spaces "New workspace": create an Experiment, Project or Product in
// the right standard root without picking a directory. The directory is
// created by project.create itself (createWorkspaceRootIfMissing), then the
// workspace is classified and opened like an import.
import {
  resolveImportDestination,
  sanitizeFolderName,
} from "@t3tools/client-runtime/fourspaces/relocate";
import {
  DEFAULT_FOURSPACES_ROOT,
  resolveDefaultRoot,
  type FourSpaceKind,
} from "@t3tools/client-runtime/fourspaces/registry";
import {
  canCreateProjectInEnvironment,
  findExistingAddProject,
} from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";

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
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { FOURSPACE_LABELS, type FourSpaceWorkspaceId } from "../../fourspaces/spaces";
import {
  selectEnvironmentRegistry,
  useFourspacesRegistryStore,
} from "../../fourspaces/fourspacesRegistryStore";
import { useFourspacesUiStore } from "../../fourspaces/fourspacesUiStore";
import { useOpenWorkspaceThread } from "../../fourspaces/useOpenWorkspaceThread";
import { newProjectId } from "../../lib/utils";
import { inferProjectTitleFromPath } from "../../lib/projectPaths";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import {
  buildProductContext,
  PRODUCT_CONTEXT_FILENAME,
  PRODUCT_CONTEXT_SOURCES,
} from "@t3tools/client-runtime/fourspaces/product-context";
import { KindPicker } from "./workspaceKindPicker";

function kindForSpace(space: FourSpaceWorkspaceId): FourSpaceKind {
  return space === "chat" ? "experiment" : space;
}

export function NewWorkspaceDialog({
  initialSpace,
  originProductId,
}: {
  initialSpace: FourSpaceWorkspaceId;
  originProductId: string | null;
}) {
  const closeDialog = useFourspacesUiStore((state) => state.closeDialog);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Created in the standard root. You never have to pick a directory.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          <NewWorkspaceForm
            initialSpace={initialSpace}
            onDone={closeDialog}
            originProductId={originProductId}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function NewWorkspaceForm({
  initialSpace,
  originProductId,
  onDone,
}: {
  initialSpace: FourSpaceWorkspaceId;
  originProductId: string | null;
  onDone: () => void;
}) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registryStore = useFourspacesRegistryStore();
  const upsertEntry = useFourspacesRegistryStore((state) => state.upsertWorkspaceEntry);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const openWorkspaceThread = useOpenWorkspaceThread();
  const runReadFile = useAtomQueryRunner(projectEnvironment.readFile, { reportFailure: false });
  const runWriteFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });

  const readProductContextSnapshot = async (input: {
    environmentId: EnvironmentId;
    productRoot: string;
    productTitle: string;
    experimentName: string;
  }): Promise<string | null> => {
    const sources = [];
    for (const path of PRODUCT_CONTEXT_SOURCES) {
      const result = await runReadFile({
        environmentId: input.environmentId,
        input: { cwd: input.productRoot, relativePath: path },
      });
      sources.push({
        path,
        contents: result._tag === "Success" ? result.value.contents : null,
      });
    }
    return buildProductContext({
      productTitle: input.productTitle,
      productRoot: input.productRoot,
      experimentName: input.experimentName,
      createdAt: new Date().toISOString().slice(0, 10),
      sources,
    });
  };
  const [kind, setKind] = useState<FourSpaceKind>(() => kindForSpace(initialSpace));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // New workspaces target the primary machine; Import covers the rest.
  const resolvedEnvironmentId = primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const environment = environments.find((item) => item.environmentId === resolvedEnvironmentId);
  const registryState =
    resolvedEnvironmentId != null
      ? selectEnvironmentRegistry(registryStore, resolvedEnvironmentId)
      : null;
  const defaultRoot = registryState ? resolveDefaultRoot(registryState) : DEFAULT_FOURSPACES_ROOT;
  const destination =
    resolvedEnvironmentId != null ? resolveImportDestination(defaultRoot, kind, name) : null;
  const originEntry = originProductId
    ? (registryState?.entries.find((entry) => entry.workspaceId === originProductId) ?? null)
    : null;
  const originProject = originEntry?.projectId
    ? projects.find((project) => project.id === originEntry.projectId)
    : undefined;

  const submit = async () => {
    if (!resolvedEnvironmentId || busy) return;
    setError(null);
    if (!canCreateProjectInEnvironment(environment?.connection.phase)) {
      setError("The selected machine is not connected.");
      return;
    }
    const folder = sanitizeFolderName(name);
    if (!folder) {
      setError("Give the workspace a name.");
      inputRef.current?.focus();
      return;
    }
    const root = resolveImportDestination(defaultRoot, kind, folder);
    if (!root) {
      setError("Give the workspace a name.");
      return;
    }
    if (findExistingAddProject({ projects, environmentId: resolvedEnvironmentId, path: root })) {
      setError("A workspace already lives there. Choose another name.");
      return;
    }
    setBusy(true);
    try {
      const projectId = newProjectId();
      const created = await createProject({
        environmentId: resolvedEnvironmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(root),
          workspaceRoot: root,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      });
      if (created._tag === "Failure") {
        if (!isAtomCommandInterrupted(created)) {
          const cause = squashAtomCommandFailure(created);
          setError(cause instanceof Error ? cause.message : "The workspace could not be created.");
        }
        return;
      }
      upsertEntry(resolvedEnvironmentId, {
        workspaceId: projectId,
        workspaceRoot: root,
        projectId,
        kind,
        ...(originProductId ? { originProductId } : {}),
      });
      // Experiments created from a product carry a compact context snapshot
      // so they work standalone in any harness. Best effort: a missing
      // snapshot never blocks creation.
      if (originProductId && originProject) {
        const contextBody = await readProductContextSnapshot({
          environmentId: resolvedEnvironmentId,
          productRoot: originProject.workspaceRoot,
          productTitle: originProject.title,
          experimentName: folder,
        });
        if (contextBody) {
          const written = await runWriteFile({
            environmentId: resolvedEnvironmentId,
            input: { cwd: root, relativePath: PRODUCT_CONTEXT_FILENAME, contents: contextBody },
          });
          if (written._tag === "Failure" && !isAtomCommandInterrupted(written)) {
            toastManager.add({
              type: "warning",
              title: "Workspace created without product context",
              description: `${PRODUCT_CONTEXT_FILENAME} could not be written.`,
            });
          }
        }
      }
      toastManager.add({
        type: "success",
        title: `New ${FOURSPACE_LABELS[kind]}`,
        description: root,
      });
      onDone();
      await openWorkspaceThread({
        environmentId: resolvedEnvironmentId,
        projectId,
        kind,
        root,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      <KindPicker value={kind} onChange={setKind} />
      {originProject ? (
        <p className="text-[13px] text-muted-foreground">
          From: <span className="font-medium text-foreground">{originProject.title}</span> — a
          product context snapshot ({PRODUCT_CONTEXT_FILENAME}) travels along when the product has
          notes to share.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium text-foreground">Name</span>
        <Input
          aria-label="Workspace name"
          autoFocus
          onChange={(event) => {
            setName(event.currentTarget.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="my-experiment"
          ref={inputRef}
          value={name}
        />
        <span className="text-xs text-muted-foreground">Destination: {destination ?? "—"}</span>
      </div>
      {error ? (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button disabled={busy} onClick={() => void submit()} size="sm" type="button">
          {busy ? "Creating…" : `Create ${FOURSPACE_LABELS[kind]}`}
        </Button>
      </DialogFooter>
    </div>
  );
}
