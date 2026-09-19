// Four Spaces workspace import: register any local folder as an
// Experiment, Project or Product — in place (default), moved, or copied
// into the standard roots — plus batch classification of T3 workspaces
// that were never organized ("Import from T3").
//
// Registration reuses the normal T3 flows: project.create for new roots,
// project.meta.update when a move carries an existing project along, and a
// registry row for the classification. Moves and copies go through the
// fourspaces.relocateWorkspace RPC; nothing is ever rewritten in place.
import {
  resolveImportDestination,
  basenameForImport,
  type WorkspaceImportMode,
} from "@t3tools/client-runtime/fourspaces/relocate";
import {
  DEFAULT_FOURSPACES_ROOT,
  resolveDefaultImportMode,
  resolveDefaultRoot,
  selectOrganizedWorkspaces,
  selectUnsortedProjects,
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
import { RelocateWorkspaceError, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useMemo, useState } from "react";

import { readLocalApi } from "../../localApi";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { FOURSPACE_LABELS, type FourSpaceWorkspaceId } from "../../fourspaces/spaces";
import { KIND_OPTIONS, KindPicker } from "./workspaceKindPicker";
import {
  selectEnvironmentRegistry,
  useFourspacesRegistryStore,
} from "../../fourspaces/fourspacesRegistryStore";
import { useFourspacesUiStore } from "../../fourspaces/fourspacesUiStore";
import { newProjectId } from "../../lib/utils";
import { useOpenWorkspaceThread } from "../../fourspaces/useOpenWorkspaceThread";
import {
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../../lib/projectPaths";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { fourspacesEnvironment } from "../../state/fourspaces";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

const isRelocateWorkspaceError = Schema.is(RelocateWorkspaceError);

function kindForSpace(space: FourSpaceWorkspaceId): FourSpaceKind {
  return space === "chat" ? "experiment" : space;
}

function relocateErrorMessage(error: unknown): string {
  if (isRelocateWorkspaceError(error)) {
    switch (error.failure) {
      case "source_missing":
        return "That folder doesn't exist on the selected machine.";
      case "source_not_directory":
        return "That path is a file, not a folder.";
      case "destination_exists":
        return "The destination already exists. Choose another folder name.";
      default:
        break;
    }
    if (error.message.trim().length > 0) return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The folder could not be moved or copied.";
}

export function ImportWorkspaceDialog() {
  const dialog = useFourspacesUiStore((state) => state.dialog);
  const openImportDialog = useFourspacesUiStore((state) => state.openImportDialog);
  const openOrganizeDialog = useFourspacesUiStore((state) => state.openOrganizeDialog);
  const closeDialog = useFourspacesUiStore((state) => state.closeDialog);
  if (!dialog) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {dialog.mode === "import" ? "Import workspace" : "Organize workspaces"}
          </DialogTitle>
          <DialogDescription>
            {dialog.mode === "import"
              ? "Register any folder as an Experiment, Project or Product. Nothing inside it is changed."
              : "Classify existing T3 workspaces, or change the type of organized ones. Moving is optional."}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex gap-1 rounded-lg bg-input/40 p-1"
          role="tablist"
          aria-label="Import source"
        >
          <button
            aria-selected={dialog.mode === "import"}
            className={
              dialog.mode === "import"
                ? "flex-1 cursor-pointer rounded-md bg-background px-2 py-1.5 text-[13px] font-medium text-foreground shadow-sm"
                : "flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            }
            onClick={() => openImportDialog(dialog.space)}
            role="tab"
            type="button"
          >
            Import folder
          </button>
          <button
            aria-selected={dialog.mode === "organize"}
            className={
              dialog.mode === "organize"
                ? "flex-1 cursor-pointer rounded-md bg-background px-2 py-1.5 text-[13px] font-medium text-foreground shadow-sm"
                : "flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            }
            onClick={() => openOrganizeDialog(dialog.space)}
            role="tab"
            type="button"
          >
            From T3
          </button>
        </div>
        <DialogPanel className="flex min-h-0 flex-col">
          {dialog.mode === "import" ? (
            <ImportFolderPanel initialSpace={dialog.space} onDone={closeDialog} />
          ) : (
            <OrganizePanel initialSpace={dialog.space} onDone={closeDialog} />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function useDialogEnvironment() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const resolvedId =
    environmentId ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const environment = environments.find((item) => item.environmentId === resolvedId) ?? null;
  return { environments, environmentId: resolvedId, environment, setEnvironmentId };
}

function EnvironmentPicker({
  value,
  onChange,
}: {
  value: EnvironmentId | null;
  onChange: (value: EnvironmentId) => void;
}) {
  const { environments } = useEnvironments();
  if (environments.length <= 1) return null;
  return (
    <label className="flex flex-col gap-1.5 text-[13px]">
      <span className="font-medium text-foreground">Machine</span>
      <Select
        items={environments.map((item) => ({
          value: item.environmentId,
          label: item.label ?? item.environmentId,
        }))}
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as EnvironmentId);
        }}
      >
        <SelectTrigger aria-label="Machine">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {environments.map((item) => (
            <SelectItem key={item.environmentId} value={item.environmentId}>
              {item.label ?? item.environmentId}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

const IMPORT_MODES: ReadonlyArray<{ value: WorkspaceImportMode; label: string; hint: string }> = [
  { value: "keep", label: "Keep in place", hint: "The folder stays where it is. Recommended." },
  { value: "move", label: "Move into Four Spaces", hint: "Moves the folder to the standard root." },
  { value: "copy", label: "Copy into Four Spaces", hint: "Leaves the original, works on a copy." },
];

function ImportFolderPanel({
  initialSpace,
  onDone,
}: {
  initialSpace: FourSpaceWorkspaceId;
  onDone: () => void;
}) {
  const projects = useProjects();
  const { environmentId, environment, setEnvironmentId } = useDialogEnvironment();
  const registryStore = useFourspacesRegistryStore();
  const upsertEntry = useFourspacesRegistryStore((state) => state.upsertWorkspaceEntry);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const relocate = useAtomCommand(fourspacesEnvironment.relocateWorkspace, {
    reportFailure: false,
  });
  const openWorkspaceThread = useOpenWorkspaceThread();
  const [sourcePath, setSourcePath] = useState("");
  const [kind, setKind] = useState<FourSpaceKind>(() => kindForSpace(initialSpace));
  const [modeOverride, setModeOverride] = useState<WorkspaceImportMode | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = environment?.serverConfig?.environment.platform.os ?? "";
  const registryState =
    environmentId != null ? selectEnvironmentRegistry(registryStore, environmentId) : null;
  const defaultRoot = registryState ? resolveDefaultRoot(registryState) : DEFAULT_FOURSPACES_ROOT;
  const mode = modeOverride ?? (registryState ? resolveDefaultImportMode(registryState) : "keep");
  const effectiveFolderName = folderName ?? basenameForImport(sourcePath);
  const destination =
    mode === "keep" || environmentId == null
      ? null
      : resolveImportDestination(defaultRoot, kind, effectiveFolderName);
  const resolvedSource = resolveProjectPathForDispatch(sourcePath, null);
  const existing = useMemo(
    () =>
      environmentId && resolvedSource
        ? (findExistingAddProject({ projects, environmentId, path: resolvedSource }) ?? null)
        : null,
    [environmentId, projects, resolvedSource],
  );

  const pickFolder = async () => {
    try {
      const picked = await readLocalApi()?.dialogs.pickFolder(
        sourcePath.trim() ? { initialPath: sourcePath.trim() } : undefined,
      );
      if (picked) {
        setSourcePath(picked);
        setFolderName(null);
        setError(null);
      }
    } catch {
      setBrowsing((open) => !open);
    }
  };

  const submit = async () => {
    if (!environmentId || busy) return;
    setError(null);
    if (!canCreateProjectInEnvironment(environment?.connection.phase)) {
      setError("The selected machine is not connected.");
      return;
    }
    const raw = sourcePath.trim();
    if (!raw) {
      setError("Choose a folder to import.");
      return;
    }
    if (isUnsupportedWindowsProjectPath(raw, platform)) {
      setError("Windows-style paths are only supported on Windows machines.");
      return;
    }
    if (isExplicitRelativeProjectPath(raw)) {
      setError("Use an absolute path, starting with / or ~.");
      return;
    }
    const source = resolveProjectPathForDispatch(raw, null);
    if (!source) {
      setError("Choose a folder to import.");
      return;
    }
    const finalRoot = mode === "keep" ? source : destination;
    if (!finalRoot) {
      setError("Choose a folder name for the destination.");
      return;
    }
    setBusy(true);
    try {
      const known = findExistingAddProject({ projects, environmentId, path: source });
      let openedProjectId: string | null = null;
      if (mode !== "keep") {
        const relocated = await relocate({
          environmentId,
          input: { sourcePath: source, destinationPath: finalRoot, mode },
        });
        if (relocated._tag === "Failure") {
          if (!isAtomCommandInterrupted(relocated)) {
            setError(relocateErrorMessage(squashAtomCommandFailure(relocated)));
          }
          return;
        }
        if (known && mode === "move") {
          // The project keeps its identity (threads, history, Git): only the root moves.
          const updated = await updateProject({
            environmentId,
            input: { projectId: known.id, workspaceRoot: relocated.value.destinationPath },
          });
          if (updated._tag === "Failure") {
            if (!isAtomCommandInterrupted(updated)) {
              setError(
                `The folder moved to ${relocated.value.destinationPath}, but the workspace record could not follow it. Import that folder again with Keep in place.`,
              );
            }
            return;
          }
          upsertEntry(environmentId, {
            workspaceId: known.id,
            workspaceRoot: relocated.value.destinationPath,
            projectId: known.id,
            kind,
          });
          openedProjectId = known.id;
        } else {
          const projectId = newProjectId();
          const created = await createProject({
            environmentId,
            input: {
              projectId,
              title: inferProjectTitleFromPath(finalRoot),
              workspaceRoot: finalRoot,
              createWorkspaceRootIfMissing: true,
              defaultModelSelection: null,
            },
          });
          if (created._tag === "Failure") {
            if (!isAtomCommandInterrupted(created)) {
              setError(
                mode === "move"
                  ? `The folder moved to ${relocated.value.destinationPath}, but registration failed. Import that folder again with Keep in place.`
                  : `The copy is at ${relocated.value.destinationPath}, but registration failed. Import that folder again with Keep in place.`,
              );
            }
            return;
          }
          upsertEntry(environmentId, {
            workspaceId: projectId,
            workspaceRoot: finalRoot,
            projectId,
            kind,
          });
          openedProjectId = projectId;
        }
      } else if (known) {
        upsertEntry(environmentId, {
          workspaceId: known.id,
          workspaceRoot: known.workspaceRoot,
          projectId: known.id,
          kind,
        });
        openedProjectId = known.id;
      } else {
        const projectId = newProjectId();
        const created = await createProject({
          environmentId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(source),
            workspaceRoot: source,
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: null,
          },
        });
        if (created._tag === "Failure") {
          if (!isAtomCommandInterrupted(created)) {
            const cause = squashAtomCommandFailure(created);
            setError(
              cause instanceof Error ? cause.message : "The workspace could not be registered.",
            );
          }
          return;
        }
        upsertEntry(environmentId, {
          workspaceId: projectId,
          workspaceRoot: source,
          projectId,
          kind,
        });
        openedProjectId = projectId;
      }
      toastManager.add({
        type: "success",
        title: `Imported as ${FOURSPACE_LABELS[kind]}`,
        description: finalRoot,
      });
      onDone();
      if (openedProjectId) {
        await openWorkspaceThread({
          environmentId,
          projectId: openedProjectId as ProjectId,
          kind,
          root: finalRoot,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      <EnvironmentPicker value={environmentId} onChange={setEnvironmentId} />
      <div className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium text-foreground">Folder</span>
        <div className="flex gap-2">
          <Input
            aria-label="Folder to import"
            className="min-w-0 flex-1"
            onChange={(event) => {
              setSourcePath(event.currentTarget.value);
              setFolderName(null);
              setError(null);
            }}
            placeholder="/Volumes/Data/my-project"
            value={sourcePath}
          />
          <Button onClick={() => void pickFolder()} size="sm" type="button" variant="outline">
            Browse…
          </Button>
        </div>
        {browsing ? (
          <ServerFolderBrowser
            environmentId={environmentId}
            onPick={(path) => {
              setSourcePath(path);
              setFolderName(null);
              setBrowsing(false);
              setError(null);
            }}
          />
        ) : null}
        {existing ? (
          <span className="text-xs text-muted-foreground">
            Already a T3 workspace (“{existing.title}”). Importing keeps its threads and history.
          </span>
        ) : null}
      </div>
      <KindPicker value={kind} onChange={setKind} />
      <div className="flex flex-col gap-1.5 text-[13px]">
        <span className="font-medium text-foreground">Location</span>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Import location">
          {IMPORT_MODES.map((option) => (
            <button
              className={
                mode === option.value
                  ? "cursor-pointer rounded-lg border border-ring/60 bg-card px-3 py-2 text-left"
                  : "cursor-pointer rounded-lg border border-border/70 px-3 py-2 text-left hover:bg-card/60"
              }
              key={option.value}
              onClick={() => {
                setModeOverride(option.value);
                setError(null);
              }}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
            >
              <span className="block font-medium text-foreground">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>
      {mode !== "keep" ? (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium text-foreground">Folder name in Four Spaces</span>
          <Input
            aria-label="Folder name in Four Spaces"
            onChange={(event) => {
              setFolderName(event.currentTarget.value);
              setError(null);
            }}
            value={effectiveFolderName}
          />
          <span className="text-xs text-muted-foreground">Destination: {destination ?? "—"}</span>
        </div>
      ) : null}
      {error ? (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button disabled={busy} onClick={() => void submit()} size="sm" type="button">
          {busy
            ? "Importing…"
            : mode === "keep"
              ? "Import"
              : mode === "move"
                ? "Move & import"
                : "Copy & import"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ServerFolderBrowser({
  environmentId,
  onPick,
}: {
  environmentId: EnvironmentId | null;
  onPick: (path: string) => void;
}) {
  const [directory, setDirectory] = useState("~/");
  const query = useEnvironmentQuery(
    environmentId
      ? filesystemEnvironment.browse({ environmentId, input: { partialPath: directory } })
      : null,
  );
  const entries = query.data?.entries ?? [];
  return (
    <div className="flex max-h-48 flex-col overflow-hidden rounded-lg border border-border/70">
      <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">{directory}</span>
        <Button onClick={() => onPick(directory)} size="xs" type="button" variant="outline">
          Use this folder
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {query.isPending ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</p>
        ) : query.error ? (
          <p className="px-3 py-1.5 text-xs text-destructive">{query.error}</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">Empty folder.</p>
        ) : (
          entries.map((entry) => (
            <button
              className="block w-full cursor-pointer truncate px-3 py-1.5 text-left font-mono text-xs hover:bg-accent"
              key={entry.fullPath}
              onClick={() => setDirectory(entry.fullPath)}
              type="button"
            >
              {entry.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function OrganizePanel({
  initialSpace,
  onDone,
}: {
  initialSpace: FourSpaceWorkspaceId;
  onDone: () => void;
}) {
  const projects = useProjects();
  const { environmentId, environment, setEnvironmentId } = useDialogEnvironment();
  const registryStore = useFourspacesRegistryStore();
  const upsertEntry = useFourspacesRegistryStore((state) => state.upsertWorkspaceEntry);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const relocate = useAtomCommand(fourspacesEnvironment.relocateWorkspace, {
    reportFailure: false,
  });
  const [checked, setChecked] = useState<ReadonlySet<string> | null>(null);
  const [kinds, setKinds] = useState<Record<string, FourSpaceKind>>({});
  const [promoteChecked, setPromoteChecked] = useState<ReadonlySet<string>>(new Set());
  const [promoteKinds, setPromoteKinds] = useState<Record<string, FourSpaceKind>>({});
  const [promoteMoves, setPromoteMoves] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registryState =
    environmentId != null ? selectEnvironmentRegistry(registryStore, environmentId) : null;
  const defaultRoot = registryState ? resolveDefaultRoot(registryState) : DEFAULT_FOURSPACES_ROOT;
  const unsorted = useMemo(
    () =>
      environmentId != null && registryState
        ? selectUnsortedProjects(projects, environmentId, registryState)
        : [],
    [environmentId, projects, registryState],
  );
  const organized = registryState ? selectOrganizedWorkspaces(registryState) : [];
  const checkedIds = checked ?? new Set(unsorted.map((project) => project.id));
  const kindFor = (projectId: string): FourSpaceKind =>
    kinds[projectId] ?? kindForSpace(initialSpace);

  if (!environmentId || !canCreateProjectInEnvironment(environment?.connection.phase)) {
    return (
      <p className="text-[13px] text-muted-foreground">The selected machine is not connected.</p>
    );
  }
  if (unsorted.length === 0 && organized.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No workspaces on this machine yet — import a folder to get started.
      </p>
    );
  }

  const toggle = (projectId: string) => {
    const next = new Set(checkedIds);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    setChecked(next);
  };

  const togglePromote = (workspaceId: string) => {
    const next = new Set(promoteChecked);
    if (next.has(workspaceId)) next.delete(workspaceId);
    else next.add(workspaceId);
    setPromoteChecked(next);
  };

  const promoteKindFor = (workspaceId: string, current: FourSpaceKind): FourSpaceKind =>
    promoteKinds[workspaceId] ?? current;

  const promoteDestinationFor = (workspaceId: string, root: string, kind: FourSpaceKind) =>
    resolveImportDestination(defaultRoot, kind, basenameForImport(root));

  const apply = async () => {
    if (busy || !environmentId) return;
    setBusy(true);
    setError(null);
    try {
      let count = 0;
      let firstError: string | null = null;
      for (const project of unsorted) {
        if (!checkedIds.has(project.id)) continue;
        const kind = kindFor(project.id);
        upsertEntry(environmentId, {
          workspaceId: project.id,
          workspaceRoot: project.workspaceRoot,
          projectId: project.id,
          kind,
        });
        count += 1;
      }
      // Snapshot the promote jobs before the first await: dialog state may
      // change while a relocate is in flight, and jobs must not shift.
      const promoteJobs = organized.flatMap((item) => {
        if (!promoteChecked.has(item.entry.workspaceId)) return [];
        const newKind = promoteKindFor(item.entry.workspaceId, item.entry.kind);
        const wantMove = !!promoteMoves[item.entry.workspaceId];
        const destination = promoteDestinationFor(
          item.entry.workspaceId,
          item.workspaceRoot,
          newKind,
        );
        const kindChanged = newKind !== item.entry.kind;
        const moveChanged = wantMove && destination !== null && destination !== item.workspaceRoot;
        if (!kindChanged && !moveChanged) return [];
        return [{ item, newKind, destination: moveChanged ? destination : null }];
      });
      for (const job of promoteJobs) {
        const { item, newKind, destination } = job;
        if (destination) {
          const relocated = await relocate({
            environmentId,
            input: { sourcePath: item.workspaceRoot, destinationPath: destination, mode: "move" },
          });
          if (relocated._tag === "Failure") {
            if (!isAtomCommandInterrupted(relocated)) {
              firstError ??= relocateErrorMessage(squashAtomCommandFailure(relocated));
            }
            continue;
          }
          const nextRoot = relocated.value.destinationPath;
          if (item.projectId) {
            const updated = await updateProject({
              environmentId,
              input: { projectId: item.projectId as ProjectId, workspaceRoot: nextRoot },
            });
            if (updated._tag === "Failure") {
              if (!isAtomCommandInterrupted(updated)) {
                firstError ??= `The folder moved to ${nextRoot}, but the workspace record could not follow it. Import that folder again with Keep in place.`;
              }
            }
          }
          upsertEntry(environmentId, { ...item.entry, workspaceRoot: nextRoot, kind: newKind });
          count += 1;
        } else {
          upsertEntry(environmentId, { ...item.entry, kind: newKind });
          count += 1;
        }
      }
      if (firstError) {
        setError(firstError);
        return;
      }
      toastManager.add({
        type: "success",
        title:
          count === 1
            ? "Organized 1 workspace"
            : unsorted.length > 0 && organized.length === 0 && count === checkedIds.size
              ? `Organized ${count} workspaces`
              : `Applied ${count} changes`,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const totalSelected = checkedIds.size + promoteChecked.size;
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      <EnvironmentPicker value={environmentId} onChange={setEnvironmentId} />
      {unsorted.length > 0 ? (
        <>
          <h3 className="text-[13px] font-medium text-foreground">Unsorted workspaces</h3>
          <div className="flex items-center gap-2 text-[13px]">
            <button
              className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline"
              onClick={() =>
                setChecked(
                  checkedIds.size === unsorted.length
                    ? new Set()
                    : new Set(unsorted.map((project) => project.id)),
                )
              }
              type="button"
            >
              {checkedIds.size === unsorted.length ? "Select none" : "Select all"}
            </button>
            <span className="text-muted-foreground">
              {checkedIds.size} of {unsorted.length} selected
            </span>
          </div>
          {unsorted.map((project) => (
            <div
              className="flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2"
              key={`${project.environmentId}:${project.id}`}
            >
              <input
                aria-label={`Select ${project.title}`}
                checked={checkedIds.has(project.id)}
                className="size-4 shrink-0"
                onChange={() => toggle(project.id)}
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{project.title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {project.workspaceRoot}
                </p>
              </div>
              <div
                className="flex shrink-0 gap-0.5 rounded-md bg-input/40 p-0.5"
                role="radiogroup"
                aria-label={`Type for ${project.title}`}
              >
                {KIND_OPTIONS.map((kind) => (
                  <button
                    aria-pressed={kindFor(project.id) === kind}
                    className={
                      kindFor(project.id) === kind
                        ? "cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium text-foreground shadow-sm bg-background"
                        : "cursor-pointer rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    }
                    key={kind}
                    onClick={() => setKinds((current) => ({ ...current, [project.id]: kind }))}
                    type="button"
                    role="radio"
                    aria-checked={kindFor(project.id) === kind}
                  >
                    {FOURSPACE_LABELS[kind]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
      {organized.length > 0 ? (
        <>
          <h3 className="text-[13px] font-medium text-foreground">Organized workspaces</h3>
          <p className="text-xs text-muted-foreground">
            Change the type without moving, or tick Move to relocate into the standard root. The
            workspace keeps its threads, history and Git either way.
          </p>
          {organized.map((item) => {
            const linked = item.projectId
              ? (projects.find((project) => project.id === item.projectId) ?? null)
              : null;
            const title = linked?.title ?? basenameForImport(item.workspaceRoot);
            const newKind = promoteKindFor(item.entry.workspaceId, item.entry.kind);
            const wantMove = !!promoteMoves[item.entry.workspaceId];
            const destination = promoteDestinationFor(
              item.entry.workspaceId,
              item.workspaceRoot,
              newKind,
            );
            const kindChanged = newKind !== item.entry.kind;
            return (
              <div
                className="flex flex-col gap-2 rounded-lg border border-border/70 px-2.5 py-2"
                key={item.entry.workspaceId}
              >
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Promote ${title}`}
                    checked={promoteChecked.has(item.entry.workspaceId)}
                    className="size-4 shrink-0"
                    onChange={() => togglePromote(item.entry.workspaceId)}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {title}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({FOURSPACE_LABELS[item.entry.kind]})
                      </span>
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {item.workspaceRoot}
                    </p>
                  </div>
                  <div
                    className="flex shrink-0 gap-0.5 rounded-md bg-input/40 p-0.5"
                    role="radiogroup"
                    aria-label={`New type for ${title}`}
                  >
                    {KIND_OPTIONS.map((kind) => (
                      <button
                        aria-pressed={newKind === kind}
                        className={
                          newKind === kind
                            ? "cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium text-foreground shadow-sm bg-background"
                            : "cursor-pointer rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        }
                        key={kind}
                        onClick={() =>
                          setPromoteKinds((current) => ({
                            ...current,
                            [item.entry.workspaceId]: kind,
                          }))
                        }
                        type="button"
                        role="radio"
                        aria-checked={newKind === kind}
                      >
                        {FOURSPACE_LABELS[kind]}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    aria-label={`Move ${title} into standard root`}
                    checked={wantMove}
                    className="size-3.5 shrink-0"
                    onChange={() =>
                      setPromoteMoves((current) => ({
                        ...current,
                        [item.entry.workspaceId]: !wantMove,
                      }))
                    }
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {wantMove
                      ? `Move to ${destination ?? "—"}`
                      : `Keep in place${kindChanged ? ` (type becomes ${FOURSPACE_LABELS[newKind]})` : ""}`}
                  </span>
                </label>
              </div>
            );
          })}
        </>
      ) : null}
      {error ? (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          disabled={busy || totalSelected === 0}
          onClick={() => void apply()}
          size="sm"
          type="button"
        >
          {busy ? "Applying…" : `Apply (${totalSelected} selected)`}
        </Button>
      </DialogFooter>
    </div>
  );
}
