// Four Spaces shell: the workspace kinds Four Spaces organizes. Kept separate
// from T3's core project model on purpose — classification lives in a small
// side system (registry), never inside OrchestrationProject.
import type { FourSpaceKind } from "@t3tools/client-runtime/fourspaces/registry";

export const FOURSPACE_WORKSPACE_IDS = ["chat", "experiment", "project", "product"] as const;

export type FourSpaceWorkspaceId = FourSpaceKind | "chat";

export type FourSpaceId = FourSpaceWorkspaceId | "scheduled" | "settings";

export const FOURSPACE_LABELS: Record<FourSpaceId, string> = {
  chat: "Chat",
  experiment: "Experiment",
  project: "Project",
  product: "Product",
  scheduled: "Scheduled",
  settings: "Settings",
};

export function isFourSpaceWorkspaceId(value: unknown): value is FourSpaceWorkspaceId {
  return (FOURSPACE_WORKSPACE_IDS as ReadonlyArray<unknown>).includes(value);
}

// Spaces are a UI dimension, not a URL dimension: thread URLs stay exactly as
// T3 defines them (`/$environmentId/$threadId`) so bookmarks, history and
// remote clients keep working. Only Scheduled and Settings own routes.
export function resolveFourSpaceForPathname(
  pathname: string,
  activeWorkspaceSpace: FourSpaceWorkspaceId,
): FourSpaceId {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "settings";
  }
  if (pathname === "/scheduled") {
    return "scheduled";
  }
  return activeWorkspaceSpace;
}
