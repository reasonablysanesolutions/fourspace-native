// Four Spaces import helpers (pure, shared by web + mobile).
//
// Naming rules for workspaces created through Move/Copy: the folder keeps its
// source basename under the kind's standard directory. Registration itself
// (project.create/meta.update + registry row) stays a caller composition.
import type { FourSpaceKind } from "./registry.ts";

export const KIND_DIRECTORY_NAMES: Record<FourSpaceKind, string> = {
  experiment: "Experiments",
  project: "Projects",
  product: "Products",
};

export type WorkspaceImportMode = "keep" | "move" | "copy";

/** Last path segment, tolerant of pasted paths with trailing separators. */
export function basenameForImport(sourcePath: string): string {
  const trimmed = sourcePath.trim().replace(/[/\\]+$/, "");
  if (trimmed.length === 0) return "";
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSlash < 0 ? trimmed : trimmed.slice(lastSlash + 1);
}

/**
 * A safe single folder name, or null when nothing usable remains. Never
 * returns a path: separators become dashes so a pasted path cannot escape
 * the destination directory.
 */
export function sanitizeFolderName(value: string): string | null {
  const collapsed = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length === 0 || collapsed === "." || collapsed === "..") return null;
  return collapsed.slice(0, 128);
}

export function resolveImportDestination(
  defaultRoot: string,
  kind: FourSpaceKind,
  folderName: string,
): string | null {
  const folder = sanitizeFolderName(folderName);
  const root = defaultRoot.trim().replace(/[/\\]+$/, "");
  if (!folder || root.length === 0) return null;
  return `${root}/${KIND_DIRECTORY_NAMES[kind]}/${folder}`;
}
