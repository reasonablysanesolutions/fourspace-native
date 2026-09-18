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
    scheduledListJobs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scheduled:list-jobs",
      tag: WS_METHODS.scheduledListJobs,
      staleTimeMs: 15_000,
      idleTtlMs: 60_000,
    }),
    scheduledCreateJob: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled:create-job",
      tag: WS_METHODS.scheduledCreateJob,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    scheduledUpdateJob: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled:update-job",
      tag: WS_METHODS.scheduledUpdateJob,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    scheduledDeleteJob: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled:delete-job",
      tag: WS_METHODS.scheduledDeleteJob,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    scheduledRunJobNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled:run-job-now",
      tag: WS_METHODS.scheduledRunJobNow,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    scheduledListRuns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:scheduled:list-runs",
      tag: WS_METHODS.scheduledListRuns,
      staleTimeMs: 15_000,
      idleTtlMs: 60_000,
    }),
  };
}
