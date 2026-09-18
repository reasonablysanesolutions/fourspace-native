import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ScheduledJob,
  ScheduledRun,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";
import { PauseIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isElectron } from "../env";
import { Button } from "../components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import {
  ScheduledJobDialog,
  buildSchedule,
  type ScheduledJobDraft,
} from "../components/fourspaces/ScheduledJobDialog";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { fourspacesEnvironment } from "../state/fourspaces";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";

// Global control center for scheduled jobs. Scheduled is not a workspace
// type: every job belongs to a Chat, Experiment, Project or Product
// workspace (via its T3 project). Jobs run only while the server runs.
function ScheduledRouteView() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [dialog, setDialog] = useState<{ job: ScheduledJob | null } | null>(null);

  const jobsQuery = useEnvironmentQuery(
    primaryEnvironmentId
      ? fourspacesEnvironment.scheduledListJobs({ environmentId: primaryEnvironmentId, input: {} })
      : null,
  );
  const runsQuery = useEnvironmentQuery(
    primaryEnvironmentId
      ? fourspacesEnvironment.scheduledListRuns({
          environmentId: primaryEnvironmentId,
          input: { limit: 50 },
        })
      : null,
  );
  const createJob = useAtomCommand(fourspacesEnvironment.scheduledCreateJob, {
    reportFailure: false,
  });
  const updateJob = useAtomCommand(fourspacesEnvironment.scheduledUpdateJob, {
    reportFailure: false,
  });

  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);
  const runs = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data]);
  const projectById = useMemo(() => {
    const map = new Map<string, (typeof projects)[number]>();
    for (const project of projects) map.set(project.id, project);
    return map;
  }, [projects]);

  const refreshJobs = jobsQuery.refresh;
  const refreshRuns = runsQuery.refresh;
  const refresh = useCallback(() => {
    refreshJobs();
    refreshRuns();
  }, [refreshJobs, refreshRuns]);

  // While a run is active the history goes stale within seconds: poll gently
  // until everything settles, then stop (no repainting timers otherwise).
  const hasRunning = runs.some((run) => run.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [hasRunning, refresh]);

  const upcoming = useMemo(
    () =>
      jobs
        .filter((job) => job.enabled && job.nextRunAt)
        .toSorted((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!)),
    [jobs],
  );
  const recurring = useMemo(() => jobs.filter((job) => job.schedule.kind !== "once"), [jobs]);

  const mutate = async (
    action: Promise<AtomCommandResult<unknown, unknown>>,
    successTitle: string,
  ): Promise<string | null> => {
    const result = await action;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return "Interrupted.";
      const cause = squashAtomCommandFailure(result);
      return cause instanceof Error ? cause.message : "The request failed.";
    }
    toastManager.add({ type: "success", title: successTitle });
    refresh();
    return null;
  };

  const submitDialog = async (draft: ScheduledJobDraft): Promise<string | null> => {
    if (!primaryEnvironmentId) return "No machine is connected.";
    const built = buildSchedule(draft);
    if (!built.schedule) return built.error ?? "The schedule is invalid.";
    if (dialog?.job) {
      return mutate(
        updateJob({
          environmentId: primaryEnvironmentId,
          input: {
            jobId: dialog.job.id,
            title: draft.title.trim(),
            projectId: draft.projectId as ScheduledJob["projectId"],
            prompt: draft.prompt.trim(),
            modelSelection: {
              instanceId: draft.instanceId as ProviderInstanceId,
              model: draft.model,
            },
            schedule: built.schedule,
          },
        }),
        "Job updated",
      ).then((error) => {
        if (!error) setDialog(null);
        return error;
      });
    }
    return mutate(
      createJob({
        environmentId: primaryEnvironmentId,
        input: {
          title: draft.title.trim(),
          projectId: draft.projectId as ScheduledJob["projectId"],
          prompt: draft.prompt.trim(),
          modelSelection: {
            instanceId: draft.instanceId as ProviderInstanceId,
            model: draft.model,
          },
          schedule: built.schedule,
        },
      }),
      "Job created",
    ).then((error) => {
      if (!error) setDialog(null);
      return error;
    });
  };

  const openThread = (run: ScheduledRun) => {
    if (!run.threadId || !primaryEnvironmentId) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(primaryEnvironmentId, run.threadId)),
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex w-full items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              Scheduled
            </span>
            <span className="flex-1" />
            <Button onClick={() => setDialog({ job: null })} size="xs" type="button">
              <PlusIcon className="size-3.5" />
              New job
            </Button>
          </div>
        </WorkspacePageHeader>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 overflow-y-auto px-6 py-10">
          {!primaryEnvironmentId ? (
            <p className="text-[13px] text-muted-foreground">Connect a machine to schedule jobs.</p>
          ) : null}
          <ScheduledSection
            description="Jobs waiting for their next run."
            empty="No upcoming jobs."
            title="Upcoming"
          >
            {upcoming.map((job) => (
              <JobCard
                environmentId={primaryEnvironmentId}
                job={job}
                key={job.id}
                onEdit={() => setDialog({ job })}
                onMutate={mutate}
                projectTitle={projectById.get(job.projectId)?.title ?? "Unknown workspace"}
              />
            ))}
          </ScheduledSection>
          <ScheduledSection
            description="Jobs that repeat on a daily, weekly or interval cadence."
            empty="No recurring jobs."
            title="Recurring"
          >
            {recurring.map((job) => (
              <JobCard
                environmentId={primaryEnvironmentId}
                job={job}
                key={job.id}
                onEdit={() => setDialog({ job })}
                onMutate={mutate}
                projectTitle={projectById.get(job.projectId)?.title ?? "Unknown workspace"}
              />
            ))}
          </ScheduledSection>
          <ScheduledSection
            description="Completed and failed runs, newest first."
            empty="No runs yet."
            title="History"
          >
            {runs.map((run) => {
              const started = Date.parse(run.startedAt);
              const finished = run.finishedAt ? Date.parse(run.finishedAt) : null;
              const duration =
                Number.isFinite(started) && finished !== null && Number.isFinite(finished)
                  ? formatDuration(finished - started)
                  : null;
              return (
                <div
                  className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2"
                  key={run.id}
                >
                  <span
                    aria-label={run.status}
                    className={
                      run.status === "completed"
                        ? "size-2 shrink-0 rounded-full bg-emerald-500"
                        : run.status === "failed"
                          ? "size-2 shrink-0 rounded-full bg-red-500"
                          : "size-2 shrink-0 animate-pulse rounded-full bg-amber-500"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {jobs.find((job) => job.id === run.jobId)?.title ?? "Deleted job"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                      {duration ? ` · ${duration}` : ""}
                      {run.error ? ` · ${run.error}` : ""}
                    </p>
                  </div>
                  {run.threadId ? (
                    <Button
                      onClick={() => openThread(run)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      Open thread
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </ScheduledSection>
        </div>
      </div>
      {dialog && primaryEnvironmentId ? (
        <ScheduledJobDialog
          defaultProjectId={null}
          job={dialog.job}
          key={dialog.job ? dialog.job.id : "new"}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      ) : null}
    </SidebarInset>
  );
}

function describeSchedule(job: ScheduledJob): string {
  const schedule = job.schedule;
  const time = (hour?: number, minute?: number) =>
    `${String(hour ?? 7).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
  switch (schedule.kind) {
    case "once":
      return `Once ${schedule.atIso ? new Date(schedule.atIso).toLocaleString() : ""}`.trim();
    case "daily":
      return `Daily ${time(schedule.hour, schedule.minute)}`;
    case "weekly": {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return `${days[schedule.weekday ?? 1] ?? ""} ${time(schedule.hour, schedule.minute)}`.trim();
    }
    case "interval":
      return `Every ${schedule.intervalMinutes ?? 60} min`;
  }
}

function JobCard({
  environmentId,
  job,
  projectTitle,
  onEdit,
  onMutate,
}: {
  environmentId: EnvironmentId | null;
  job: ScheduledJob;
  projectTitle: string;
  onEdit: () => void;
  onMutate: (
    action: Promise<AtomCommandResult<unknown, unknown>>,
    successTitle: string,
  ) => Promise<string | null>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fixed at mount: relative countdowns refresh with query answers.
  const [now] = useState(() => Date.now());
  const updateJob = useAtomCommand(fourspacesEnvironment.scheduledUpdateJob, {
    reportFailure: false,
  });
  const deleteJob = useAtomCommand(fourspacesEnvironment.scheduledDeleteJob, {
    reportFailure: false,
  });
  const runJobNow = useAtomCommand(fourspacesEnvironment.scheduledRunJobNow, {
    reportFailure: false,
  });

  const act = async (action: Parameters<typeof onMutate>[0], successTitle: string) => {
    if (!environmentId || busy) return;
    setBusy(true);
    try {
      const error = await onMutate(action, successTitle);
      if (error) {
        toastManager.add({ type: "error", title: successTitle, description: error });
      }
    } finally {
      setBusy(false);
    }
  };

  const nextIn = job.nextRunAt ? Date.parse(job.nextRunAt) - now : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {job.title}
        </p>
        {!job.enabled ? (
          <span className="shrink-0 rounded-md bg-input/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Paused
          </span>
        ) : null}
      </div>
      <p className="truncate text-[12px] text-muted-foreground">
        {projectTitle} · {job.modelSelection.model} · {describeSchedule(job)}
        {job.enabled && nextIn !== null && nextIn > 0 ? ` · in ${formatDuration(nextIn)}` : ""}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          disabled={busy || !environmentId}
          onClick={() =>
            environmentId &&
            void act(runJobNow({ environmentId, input: { jobId: job.id } }), "Run started")
          }
          size="xs"
          type="button"
          variant="outline"
        >
          <PlayIcon className="size-3" />
          Run now
        </Button>
        <Button
          disabled={busy || !environmentId}
          onClick={() =>
            environmentId &&
            void act(
              updateJob({ environmentId, input: { jobId: job.id, enabled: !job.enabled } }),
              job.enabled ? "Job paused" : "Job resumed",
            )
          }
          size="xs"
          type="button"
          variant="outline"
        >
          {job.enabled ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
          {job.enabled ? "Pause" : "Resume"}
        </Button>
        <Button disabled={busy} onClick={onEdit} size="xs" type="button" variant="outline">
          Edit
        </Button>
        {confirmingDelete ? (
          <Button
            disabled={busy || !environmentId}
            onClick={() => {
              if (environmentId) {
                setConfirmingDelete(false);
                void act(deleteJob({ environmentId, input: { jobId: job.id } }), "Job deleted");
              }
            }}
            size="xs"
            type="button"
            variant="destructive"
          >
            <Trash2Icon className="size-3" />
            Confirm delete
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            size="xs"
            type="button"
            variant="ghost"
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function ScheduledSection({
  description,
  empty,
  title,
  children,
}: {
  readonly description: string;
  readonly empty: string;
  readonly title: string;
  readonly children?: React.ReactNode;
}) {
  const items = children ? (Array.isArray(children) ? children : [children]).filter(Boolean) : [];
  return (
    <section aria-label={title}>
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
      {items.length === 0 ? (
        <Empty className="mt-3 border border-dashed border-border/70 bg-card/20 py-8">
          <EmptyHeader>
            <EmptyTitle className="text-sm font-normal text-muted-foreground">{empty}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-3 flex flex-col gap-2">{items}</div>
      )}
    </section>
  );
}

export const Route = createFileRoute("/scheduled")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ScheduledRouteView,
});
