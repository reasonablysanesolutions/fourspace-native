import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

/** Four Spaces workspace operations (relocation across the wire). */
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
  };
}
