import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** Four Spaces operations across the wire (relocation, OpenRouter usage). */
export function createFourspacesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    relocateWorkspace: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fourspaces:relocate-workspace",
      tag: WS_METHODS.fourspacesRelocateWorkspace,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    openRouterUsage: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:fourspaces:openrouter-usage",
      tag: WS_METHODS.fourspacesGetOpenRouterUsage,
      // The server caches for five minutes; keep the client on the same beat
      // so the bar does not refetch on every render.
      staleTimeMs: 5 * 60_000,
      idleTtlMs: 10 * 60_000,
    }),
    setOpenRouterKey: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fourspaces:set-openrouter-key",
      tag: WS_METHODS.fourspacesSetOpenRouterKey,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    clearOpenRouterKey: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fourspaces:clear-openrouter-key",
      tag: WS_METHODS.fourspacesClearOpenRouterKey,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
  };
}
