import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isNotesMissingMessage } from "@t3tools/client-runtime/fourspaces/notes";
import {
  chatWorkspaceRootFor,
  emptyEnvironmentState,
  resolveChatProjectId,
  resolveDefaultRoot,
  selectVisibleProjects,
} from "@t3tools/client-runtime/fourspaces/registry";
import { ProjectId } from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import {
  selectActiveWorkspaceSpace,
  useFourspacesNavStore,
} from "../fourspaces/fourspacesNavStore";
import {
  selectEnvironmentRegistry,
  useFourspacesRegistryStore,
} from "../fourspaces/fourspacesRegistryStore";
import { useFourspacesUiStore } from "../fourspaces/fourspacesUiStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { newProjectId } from "../lib/utils";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { APP_DISPLAY_NAME } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedStaticOnboardingState />;
  }

  return <IndexDraftLanding />;
}

const EMPTY_DEAD_ROOTS: ReadonlyArray<string> = [];
/**
 * Landing on the index route drops straight into a draft thread for the most
 * recently active project, so the first screen is a prompt instead of a dead
 * end. Falls back to an add-project hero when no project exists yet.
 *
 * Four Spaces scopes the landing to the active workspace: kind spaces pick
 * the most recent visible project (classified + unclassified, never the Chat
 * backing project), while Chat resolves its hidden backing project and
 * creates it under the Four Spaces root on first visit.
 */
function IndexDraftLanding() {
  const space = useFourspacesNavStore(selectActiveWorkspaceSpace);
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registryStore = useFourspacesRegistryStore();
  const setChatProjectId = registryStore.setChatProjectId;
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const startKeyRef = useRef<string | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });
  const markChatRootDead = useFourspacesUiStore((state) => state.markChatRootDead);
  // Session-scoped roots proven missing (see the probe below): never
  // re-adopt them while this document lives.
  const deadRootList = useFourspacesUiStore((state) =>
    primaryEnvironmentId
      ? (state.deadChatRootsByEnvironment[primaryEnvironmentId] ?? EMPTY_DEAD_ROOTS)
      : EMPTY_DEAD_ROOTS,
  );
  const deadRoots = useMemo(() => new Set(deadRootList), [deadRootList]);

  const registryState = useMemo(
    () =>
      primaryEnvironmentId
        ? selectEnvironmentRegistry(registryStore, primaryEnvironmentId)
        : emptyEnvironmentState(),
    [primaryEnvironmentId, registryStore],
  );

  const chatProjectId = useMemo(
    () =>
      space === "chat" && primaryEnvironmentId
        ? resolveChatProjectId({
            projects,
            environmentId: primaryEnvironmentId,
            state: registryState,
            excludeRoots: deadRoots,
          })
        : null,
    [space, projects, primaryEnvironmentId, registryState, deadRoots],
  );

  // Self-healing: the adopted backing project may point at a folder that was
  // deleted out-of-band (drafting into it shows T3's missing-folder banner).
  // Probe the root; when it is clearly gone, drop the link so the landing
  // below creates a fresh backing project. Any other outcome (including
  // transient errors) keeps today's behavior — never unlink on a guess.
  const chatProjectRoot =
    space === "chat" && chatProjectId
      ? (projects.find((project) => project.id === chatProjectId)?.workspaceRoot ?? null)
      : null;
  const chatRootProbe = useEnvironmentQuery(
    chatProjectRoot && primaryEnvironmentId
      ? projectEnvironment.listEntries({
          environmentId: primaryEnvironmentId,
          input: { cwd: chatProjectRoot },
        })
      : null,
  );
  const chatRootGone =
    space === "chat" &&
    chatProjectId !== null &&
    chatProjectRoot !== null &&
    !chatRootProbe.isPending &&
    !!chatRootProbe.error &&
    isNotesMissingMessage(chatRootProbe.error);

  useEffect(() => {
    if (!chatRootGone || !primaryEnvironmentId || !chatProjectId || !chatProjectRoot) return;
    setChatProjectId(primaryEnvironmentId, null);
    markChatRootDead(primaryEnvironmentId, chatProjectRoot);
    startKeyRef.current = null;
  }, [
    chatRootGone,
    primaryEnvironmentId,
    chatProjectId,
    chatProjectRoot,
    markChatRootDead,
    setChatProjectId,
  ]);

  const mostRecentProject = useMemo(
    () =>
      bootstrapped
        ? (sortScopedProjectsForSidebar(
            space === "chat"
              ? []
              : selectVisibleProjects(projects, registryStore.registriesByEnvironment, space),
            threads,
            "updated_at",
          )[0] ?? null)
        : null,
    [bootstrapped, projects, registryStore.registriesByEnvironment, space, threads],
  );

  // Start target: the resolved chat project (or a pending create), else the
  // most recent visible project. Null renders the hero / spinner states below.
  const startTarget =
    space === "chat"
      ? primaryEnvironmentId && chatProjectId
        ? scopeProjectRef(primaryEnvironmentId, ProjectId.make(chatProjectId))
        : null
      : mostRecentProject
        ? scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id)
        : null;
  const startKey = `${space}:${startTarget ? `${startTarget.environmentId}:${startTarget.projectId}` : "none"}:${startState.retryRequest}`;

  useEffect(() => {
    if (!bootstrapped || startKeyRef.current === startKey) {
      return;
    }
    // Nothing to start yet: the Chat backing project is created below, and
    // an empty kind space falls through to the hero.
    if (space === "chat" && startTarget === null && primaryEnvironmentId !== null) {
      startKeyRef.current = startKey;
      void (async () => {
        const projectId = newProjectId();
        const created = await createProject({
          environmentId: primaryEnvironmentId,
          input: {
            projectId,
            title: "Chat",
            workspaceRoot: chatWorkspaceRootFor(resolveDefaultRoot(registryState)),
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: null,
          },
        });
        if (created._tag === "Failure") {
          startKeyRef.current = null;
          setStartState((state) => ({ ...state, failed: true }));
          return;
        }
        setChatProjectId(primaryEnvironmentId, projectId);
      })().catch(() => {
        startKeyRef.current = null;
        setStartState((state) => ({ ...state, failed: true }));
      });
      return;
    }
    if (startTarget === null) {
      return;
    }
    startKeyRef.current = startKey;
    // Heal the stored id when the backing project was adopted by root
    // instead of by stored id (same value → no-op, no render loop).
    if (space === "chat" && chatProjectId && registryState.chatProjectId !== chatProjectId) {
      setChatProjectId(primaryEnvironmentId!, chatProjectId);
    }
    void handleNewThread(startTarget, {
      replace: true,
    }).catch(() => {
      startKeyRef.current = null;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [
    bootstrapped,
    chatProjectId,
    createProject,
    handleNewThread,
    primaryEnvironmentId,
    registryState,
    setChatProjectId,
    space,
    startKey,
    startTarget,
  ]);

  if (!bootstrapped) {
    return null;
  }
  if (startTarget !== null || (space === "chat" && primaryEnvironmentId !== null)) {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  // First-run routing to the welcome wizard happens in FirstRunGate at the
  // root, before this route ever renders.
  return <NoProjectsHero />;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground text-xl">Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon className="size-4" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  const cloudEnabled = hasCloudPublicConfig();
  const localEnvironmentOff = isLocalEnvironmentDisabled();
  const description = localEnvironmentOff
    ? "The local environment is turned off. Connect a remote environment, or turn the local environment back on in Connections."
    : cloudEnabled
      ? "Enable T3 Connect on that machine, then open Connections here to sign in with the same account. You can also add the machine using a pairing link."
      : "Open Connections and add that machine using its pairing link. This app must be able to reach it.";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle className="text-foreground text-xl">
                Connect to a computer running T3 Code
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                This app connects to T3 Code running on your computer or a server. Start the T3 Code
                desktop app or command-line server on that machine and keep it running.
              </EmptyDescription>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                {description}
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Open Connections
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
