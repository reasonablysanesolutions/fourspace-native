import { createFourspacesEnvironmentAtoms } from "@t3tools/client-runtime/fourspaces/state";

import { connectionAtomRuntime } from "../connection/runtime";

export const fourspacesEnvironment = createFourspacesEnvironmentAtoms(connectionAtomRuntime);
