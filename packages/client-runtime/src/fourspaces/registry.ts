// Four Spaces workspace registry (pure logic, shared by web + mobile).
//
// Classification only organizes T3 projects — it never replaces them. A T3
// project (environment-local workspace record rooted at a directory) keeps
// working with any harness with or without these rows, and losing the
// registry only loses the organization (it can be rebuilt by classifying
// again). Kinds are deliberately limited to experiment | project | product:
// Chat is a UI dimension with a hidden backing project, never a registry
// kind, and Scheduled is a control center, not a workspace type.

import type { EnvironmentId } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";

export const FOURSPACE_KINDS = ["experiment", "project", "product"] as const;

export type FourSpaceKind = (typeof FOURSPACE_KINDS)[number];

/** A workspace space that filters T3 projects (chat included). */
export type FourSpaceWorkspaceSpace = FourSpaceKind | "chat";

export interface FourSpacesWorkspaceEntry {
  /** Stable id for the classification row. Defaults to the T3 project id when registered from one. */
  readonly workspaceId: string;
  /** Filesystem root as entered at registration (server stores the normalized form on the project). */
  readonly workspaceRoot: string;
  /** Linked T3 project, when the workspace is backed by one. */
  readonly projectId?: string | null;
  readonly kind: FourSpaceKind;
  /** Owning product's workspaceId, for experiments created from a product. */
  readonly originProductId?: string | null;
}

export interface FourSpacesEnvironmentState {
  readonly version: 1;
  /** Destination for workspaces created through Four Spaces. Null means "not configured". */
  readonly defaultRoot: string | null;
  /** T3 project backing the Chat space (hidden implementation detail). */
  readonly chatProjectId: string | null;
  readonly entries: ReadonlyArray<FourSpacesWorkspaceEntry>;
}

export type FourSpacesRegistry = Record<string, FourSpacesEnvironmentState>;

export const DEFAULT_FOURSPACES_ROOT = "~/T3";
export const CHAT_WORKSPACE_DIRNAME = "Chat";

export function emptyEnvironmentState(): FourSpacesEnvironmentState {
  return { version: 1, defaultRoot: null, chatProjectId: null, entries: [] };
}

function sanitizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function sanitizeKind(value: unknown): FourSpaceKind | null {
  return (FOURSPACE_KINDS as ReadonlyArray<unknown>).includes(value)
    ? (value as FourSpaceKind)
    : null;
}

function sanitizeEntry(value: unknown): FourSpacesWorkspaceEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const workspaceId = sanitizeString(record.workspaceId);
  const workspaceRoot = sanitizeString(record.workspaceRoot);
  const kind = sanitizeKind(record.kind);
  if (!workspaceId || !workspaceRoot || !kind) return null;
  const projectId = sanitizeString(record.projectId);
  const originProductId = sanitizeString(record.originProductId);
  return {
    workspaceId,
    workspaceRoot,
    ...(projectId ? { projectId } : {}),
    kind,
    ...(originProductId ? { originProductId } : {}),
  };
}

export function sanitizeEnvironmentState(value: unknown): FourSpacesEnvironmentState {
  const base = emptyEnvironmentState();
  if (!value || typeof value !== "object") return base;
  const record = value as Record<string, unknown>;
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const seen = new Set<string>();
  const entries: FourSpacesWorkspaceEntry[] = [];
  for (const raw of rawEntries) {
    const entry = sanitizeEntry(raw);
    if (!entry || seen.has(entry.workspaceId)) continue;
    seen.add(entry.workspaceId);
    entries.push(entry);
  }
  return {
    version: 1,
    defaultRoot: sanitizeString(record.defaultRoot),
    chatProjectId: sanitizeString(record.chatProjectId),
    entries,
  };
}

export function sanitizeRegistry(value: unknown): FourSpacesRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, FourSpacesEnvironmentState> = {};
  for (const [environmentId, state] of Object.entries(value as Record<string, unknown>)) {
    result[environmentId] = sanitizeEnvironmentState(state);
  }
  return result;
}

export function readEnvironmentState(
  registry: FourSpacesRegistry,
  environmentId: EnvironmentId,
): FourSpacesEnvironmentState {
  return registry[environmentId] ?? emptyEnvironmentState();
}

export function resolveDefaultRoot(state: FourSpacesEnvironmentState): string {
  return state.defaultRoot && state.defaultRoot.trim().length > 0
    ? state.defaultRoot
    : DEFAULT_FOURSPACES_ROOT;
}

export function chatWorkspaceRootFor(defaultRoot: string): string {
  return `${defaultRoot.trim().replace(/[/\\]+$/, "")}/${CHAT_WORKSPACE_DIRNAME}`;
}

export function upsertWorkspaceEntry(
  state: FourSpacesEnvironmentState,
  entry: FourSpacesWorkspaceEntry,
): FourSpacesEnvironmentState {
  const sanitized = sanitizeEntry(entry);
  if (!sanitized) return state;
  const entries = state.entries.some((existing) => existing.workspaceId === sanitized.workspaceId)
    ? state.entries.map((existing) =>
        existing.workspaceId === sanitized.workspaceId ? sanitized : existing,
      )
    : [...state.entries, sanitized];
  return { ...state, entries };
}

export function removeWorkspaceEntry(
  state: FourSpacesEnvironmentState,
  workspaceId: string,
): FourSpacesEnvironmentState {
  if (!state.entries.some((entry) => entry.workspaceId === workspaceId)) return state;
  return { ...state, entries: state.entries.filter((entry) => entry.workspaceId !== workspaceId) };
}

export function removeWorkspaceEntriesForProject(
  state: FourSpacesEnvironmentState,
  projectId: string,
): FourSpacesEnvironmentState {
  if (!state.entries.some((entry) => entry.projectId === projectId)) return state;
  return { ...state, entries: state.entries.filter((entry) => entry.projectId !== projectId) };
}

export function setChatProjectId(
  state: FourSpacesEnvironmentState,
  projectId: string | null,
): FourSpacesEnvironmentState {
  return state.chatProjectId === projectId ? state : { ...state, chatProjectId: projectId };
}

export function setDefaultRoot(
  state: FourSpacesEnvironmentState,
  root: string | null,
): FourSpacesEnvironmentState {
  const next = sanitizeString(root);
  return state.defaultRoot === next ? state : { ...state, defaultRoot: next };
}

export interface WorkspaceRef {
  readonly id: string;
  readonly workspaceRoot: string;
}

export function findWorkspaceEntry(
  state: FourSpacesEnvironmentState,
  ref: WorkspaceRef,
): FourSpacesWorkspaceEntry | null {
  const byProjectId = state.entries.find(
    (entry) => entry.projectId != null && entry.projectId === ref.id,
  );
  if (byProjectId) return byProjectId;
  // Fallback for workspaces whose T3 project was deleted and recreated at the
  // same path (new project id, same root). Tilde-prefixed roots are not
  // expanded here — the server stores the expanded form — so a recreated
  // project may miss and simply classify as unsorted until re-registered.
  const root = normalizeProjectPathForComparison(ref.workspaceRoot);
  return (
    state.entries.find(
      (entry) => normalizeProjectPathForComparison(entry.workspaceRoot) === root,
    ) ?? null
  );
}

export interface SpaceProject extends WorkspaceRef {
  readonly environmentId: EnvironmentId;
}

/**
 * Resolve the T3 project backing the Chat space: the stored id when it still
 * exists, otherwise a project already rooted at the Chat directory (e.g. the
 * user created it by hand), otherwise null (the caller creates it).
 *
 * The server stores home-expanded absolute roots, so a default-root chat
 * directory (`~/T3/Chat`) never string-matches. When the default root is in
 * use, also accept any project whose root ends in the default `T3/Chat`
 * layout instead of failing to adopt it on every visit.
 */
export function resolveChatProjectId(input: {
  readonly projects: ReadonlyArray<SpaceProject>;
  readonly environmentId: EnvironmentId;
  readonly state: FourSpacesEnvironmentState;
}): string | null {
  const candidates = input.projects.filter(
    (project) => project.environmentId === input.environmentId,
  );
  if (input.state.chatProjectId) {
    const stored = candidates.find((project) => project.id === input.state.chatProjectId);
    if (stored) return stored.id;
  }
  const chatRoot = normalizeProjectPathForComparison(
    chatWorkspaceRootFor(resolveDefaultRoot(input.state)),
  );
  const exact = candidates.find(
    (project) => normalizeProjectPathForComparison(project.workspaceRoot) === chatRoot,
  );
  if (exact) return exact.id;
  if (input.state.defaultRoot != null) return null;
  const tail =
    `/${DEFAULT_FOURSPACES_ROOT.replace(/^~\//, "")}/${CHAT_WORKSPACE_DIRNAME}`.toLowerCase();
  return (
    candidates.find((project) =>
      normalizeProjectPathForComparison(project.workspaceRoot)
        .replaceAll("\\", "/")
        .toLowerCase()
        .endsWith(tail),
    )?.id ?? null
  );
}

/** "chat" for the backing project, the entry kind, or null when unsorted. */
export function resolveProjectSpace(
  state: FourSpacesEnvironmentState,
  ref: WorkspaceRef,
  chatProjectId: string | null,
): FourSpaceWorkspaceSpace | null {
  if (chatProjectId && ref.id === chatProjectId) return "chat";
  return findWorkspaceEntry(state, ref)?.kind ?? null;
}

/**
 * Projects visible in a space. Classified projects show only in their own
 * kind; unclassified projects stay visible in the kind spaces so organizing
 * can never hide work (the organize flow arrives with Import). The Chat
 * space shows only its backing project.
 */
export function selectProjectsForSpace<T extends SpaceProject>(
  projects: ReadonlyArray<T>,
  environmentId: EnvironmentId,
  state: FourSpacesEnvironmentState,
  space: FourSpaceWorkspaceSpace,
): T[] {
  const candidates = projects.filter((project) => project.environmentId === environmentId);
  const chatProjectId = resolveChatProjectId({ projects, environmentId, state });
  if (space === "chat") {
    return chatProjectId ? candidates.filter((project) => project.id === chatProjectId) : [];
  }
  return candidates.filter((project) => {
    if (chatProjectId && project.id === chatProjectId) return false;
    const entry = findWorkspaceEntry(state, project);
    return entry === null || entry.kind === space;
  });
}

/** Same as selectProjectsForSpace, fanned out across every environment in one pass. */
export function selectVisibleProjects<T extends SpaceProject>(
  projects: ReadonlyArray<T>,
  registry: FourSpacesRegistry,
  space: FourSpaceWorkspaceSpace,
): T[] {
  const byEnvironment = new Map<string, T[]>();
  for (const project of projects) {
    const group = byEnvironment.get(project.environmentId);
    if (group) group.push(project);
    else byEnvironment.set(project.environmentId, [project]);
  }
  const visible: T[] = [];
  for (const [environmentId, candidates] of byEnvironment) {
    visible.push(
      ...selectProjectsForSpace(
        candidates,
        environmentId as EnvironmentId,
        readEnvironmentState(registry, environmentId as EnvironmentId),
        space,
      ),
    );
  }
  return visible;
}

/**
 * Projects with no classification in an environment (excluding the Chat
 * backing project): the "unsorted workspaces" the organize flow offers to
 * classify. Sorted by title for stable dialog lists.
 */
export function selectUnsortedProjects<T extends SpaceProject>(
  projects: ReadonlyArray<T>,
  environmentId: EnvironmentId,
  state: FourSpacesEnvironmentState,
): T[] {
  const chatProjectId = resolveChatProjectId({ projects, environmentId, state });
  return [...projects]
    .filter(
      (project) =>
        project.environmentId === environmentId &&
        project.id !== chatProjectId &&
        findWorkspaceEntry(state, project) === null,
    )
    .sort((left, right) => left.workspaceRoot.localeCompare(right.workspaceRoot));
}
