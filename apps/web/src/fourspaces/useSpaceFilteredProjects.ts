import {
  sanitizeRegistry,
  selectVisibleProjects,
  type FourSpacesRegistry,
} from "@t3tools/client-runtime/fourspaces/registry";
import { useMemo } from "react";

import { useProjects } from "../state/entities";
import type { Project } from "../types";
import { selectActiveWorkspaceSpace, useFourspacesNavStore } from "./fourspacesNavStore";
import { useFourspacesRegistryStore } from "./fourspacesRegistryStore";

function sanitizedRegistries(registries: FourSpacesRegistry): FourSpacesRegistry {
  return sanitizeRegistry(registries);
}

/**
 * T3 projects visible in the active Four Spaces workspace. Classified
 * projects show only in their own kind; unclassified projects stay visible
 * in the kind spaces so organizing can never hide work; Chat shows only its
 * hidden backing project.
 */
export function useSpaceFilteredProjects(): Project[] {
  const projects = useProjects();
  const space = useFourspacesNavStore(selectActiveWorkspaceSpace);
  const registriesByEnvironment = useFourspacesRegistryStore(
    (state) => state.registriesByEnvironment,
  );
  return useMemo(
    () => selectVisibleProjects(projects, sanitizedRegistries(registriesByEnvironment), space),
    [projects, registriesByEnvironment, space],
  );
}

/** `environmentId:projectId` keys of the space-visible projects, for thread/draft row filters. */
export function useSpaceVisibleProjectKeys(): ReadonlySet<string> {
  const projects = useSpaceFilteredProjects();
  return useMemo(
    () => new Set(projects.map((project) => `${project.environmentId}:${project.id}`)),
    [projects],
  );
}

/** Intersect two optional key filters; null means "unfiltered" on either side. */
export function intersectProjectKeySets(
  left: ReadonlySet<string> | null,
  right: ReadonlySet<string> | null,
): ReadonlySet<string> | null {
  if (left === null) return right;
  if (right === null) return left;
  const result = new Set<string>();
  for (const key of left) {
    if (right.has(key)) result.add(key);
  }
  return result;
}
