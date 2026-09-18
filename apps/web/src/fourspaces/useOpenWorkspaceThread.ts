import type { FourSpaceKind } from "@t3tools/client-runtime/fourspaces/registry";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { toastManager } from "../components/ui/toast";
import { useFourspacesNavStore } from "./fourspacesNavStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";

// Shared finish for workspace creation (New + Import): switch to the kind's
// space and open a thread, so the fresh workspace is immediately visible and
// ready. The sidebar hides threadless projects by upstream design, so without
// this the new workspace would look missing until the first thread. Returns
// whether a thread opened; callers toast their own success copy.
export function useOpenWorkspaceThread() {
  const handleNewThread = useNewThreadHandler();
  const setActiveWorkspaceSpace = useFourspacesNavStore((state) => state.setActiveWorkspaceSpace);
  return async (input: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
    kind: FourSpaceKind;
    root: string;
  }): Promise<boolean> => {
    setActiveWorkspaceSpace(input.kind);
    const thread = await settlePromise(() =>
      handleNewThread(scopeProjectRef(input.environmentId, input.projectId)),
    );
    if (thread._tag === "Failure" && !isAtomCommandInterrupted(thread)) {
      const cause = squashAtomCommandFailure(thread);
      toastManager.add({
        type: "warning",
        title: "Workspace ready, but no thread opened",
        description:
          cause instanceof Error
            ? `It is at ${input.root}: ${cause.message}`
            : `It is at ${input.root}. Open a thread manually.`,
      });
      return false;
    }
    return true;
  };
}
