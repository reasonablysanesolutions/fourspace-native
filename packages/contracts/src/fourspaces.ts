// Four Spaces workspace relocation (Move / Copy into the standard roots).
//
// The registry itself stays client-side; only the privileged filesystem
// operation crosses the wire. Registration (project.create/meta.update +
// registry row) stays a client composition on top of this call.
import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export const RelocateWorkspaceMode = Schema.Literals(["move", "copy"]);
export type RelocateWorkspaceMode = typeof RelocateWorkspaceMode.Type;

export const RelocateWorkspaceInput = Schema.Struct({
  sourcePath: TrimmedNonEmptyString,
  destinationPath: TrimmedNonEmptyString,
  mode: RelocateWorkspaceMode,
});
export type RelocateWorkspaceInput = typeof RelocateWorkspaceInput.Type;

export const RelocateWorkspaceResult = Schema.Struct({
  destinationPath: TrimmedNonEmptyString,
});
export type RelocateWorkspaceResult = typeof RelocateWorkspaceResult.Type;

export const RelocateWorkspaceFailure = Schema.Literals([
  "source_missing",
  "source_not_directory",
  "destination_exists",
  "relocate_failed",
]);
export type RelocateWorkspaceFailure = typeof RelocateWorkspaceFailure.Type;

export class RelocateWorkspaceError extends Schema.TaggedError<RelocateWorkspaceError>()(
  "RelocateWorkspaceError",
  {
    failure: Schema.optional(RelocateWorkspaceFailure),
    sourcePath: Schema.optional(Schema.String),
    destinationPath: Schema.optional(Schema.String),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ---------------------------------------------------------------------------
// OpenRouter usage/analytics.
//
// Read live from OpenRouter's own API (`/key`, `/credits`, `/activity`) with
// a key the user stores in the server secret store — never in the repo or in
// project files. Amounts are USD as reported; the UI labels them as such and
// never presents them as subscription cost.
// ---------------------------------------------------------------------------

export const OpenRouterUsageStatus = Schema.Literals(["configured", "unconfigured", "error"]);
export type OpenRouterUsageStatus = typeof OpenRouterUsageStatus.Type;

export const OpenRouterWindowTotals = Schema.Struct({
  costUsd: Schema.Number,
  requests: NonNegativeInt,
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cachedTokens: NonNegativeInt,
});
export type OpenRouterWindowTotals = typeof OpenRouterWindowTotals.Type;

export const OpenRouterModelTotals = Schema.Struct({
  model: TrimmedNonEmptyString,
  costUsd: Schema.Number,
  requests: NonNegativeInt,
  totalTokens: NonNegativeInt,
});
export type OpenRouterModelTotals = typeof OpenRouterModelTotals.Type;

export const OpenRouterUsageResult = Schema.Struct({
  status: OpenRouterUsageStatus,
  /** Key label from `/key`, when the key was accepted. */
  keyLabel: Schema.optional(TrimmedNonEmptyString),
  /** Lifetime credit limit/usage from `/credits`, when reported. */
  creditLimit: Schema.optional(Schema.Number),
  creditUsed: Schema.optional(Schema.Number),
  today: OpenRouterWindowTotals,
  last7Days: OpenRouterWindowTotals,
  last30Days: OpenRouterWindowTotals,
  /** Top models by cost over the trailing 30 days. */
  models: Schema.Array(OpenRouterModelTotals),
  fetchedAt: TrimmedNonEmptyString,
  /** Present when status is "error". Never carries the key. */
  error: Schema.optional(TrimmedNonEmptyString),
});
export type OpenRouterUsageResult = typeof OpenRouterUsageResult.Type;

export class OpenRouterUsageError extends Schema.TaggedError<OpenRouterUsageError>()(
  "OpenRouterUsageError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const SetOpenRouterKeyInput = Schema.Struct({
  key: TrimmedNonEmptyString,
});
export type SetOpenRouterKeyInput = typeof SetOpenRouterKeyInput.Type;

// ---------------------------------------------------------------------------
// Scheduled jobs.
//
// A job automates what the user could do by hand: resolve a workspace's T3
// project, create or resume a thread, submit a normal turn through the
// existing provider adapters. Jobs run only while the server runs (no
// launchd/daemon in v1). The registry workspace id is client-side only, so
// jobs store the T3 project id the client resolved at creation.
// ---------------------------------------------------------------------------

export const ScheduledJobFrequency = Schema.Literals(["once", "daily", "weekly", "interval"]);
export type ScheduledJobFrequency = typeof ScheduledJobFrequency.Type;

export const ScheduledJobSchedule = Schema.Struct({
  kind: ScheduledJobFrequency,
  /** UTC instant for `once` (ISO 8601). */
  atIso: Schema.optional(TrimmedNonEmptyString),
  /** 0 (Sunday) .. 6 (Saturday) for `weekly`. */
  weekday: Schema.optional(Schema.Int),
  /** Local hour (0..23) for `daily`/`weekly`, in `timeZone`. */
  hour: Schema.optional(Schema.Int),
  /** Local minute (0..59) for `daily`/`weekly`, in `timeZone`. */
  minute: Schema.optional(Schema.Int),
  /** Minutes between runs for `interval`. */
  intervalMinutes: Schema.optional(Schema.Int),
  /** IANA zone daily/weekly times are interpreted in. */
  timeZone: Schema.optional(TrimmedNonEmptyString),
});
export type ScheduledJobSchedule = typeof ScheduledJobSchedule.Type;

export const ScheduledJob = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  projectId: ProjectId,
  /** Resume this thread when it still exists; otherwise create a new one. */
  threadId: Schema.NullOr(ThreadId),
  prompt: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  schedule: ScheduledJobSchedule,
  enabled: Schema.Boolean,
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
  lastRunAt: Schema.NullOr(TrimmedNonEmptyString),
  nextRunAt: Schema.NullOr(TrimmedNonEmptyString),
});
export type ScheduledJob = typeof ScheduledJob.Type;

export const ScheduledRunStatus = Schema.Literals(["running", "completed", "failed"]);
export type ScheduledRunStatus = typeof ScheduledRunStatus.Type;

export const ScheduledRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  jobId: TrimmedNonEmptyString,
  /** Null when the run failed before any thread existed (e.g. project gone). */
  threadId: Schema.NullOr(ThreadId),
  startedAt: TrimmedNonEmptyString,
  finishedAt: Schema.NullOr(TrimmedNonEmptyString),
  status: ScheduledRunStatus,
  error: Schema.optional(TrimmedNonEmptyString),
});
export type ScheduledRun = typeof ScheduledRun.Type;

export const CreateScheduledJobInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  projectId: ProjectId,
  prompt: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: Schema.optional(RuntimeMode),
  schedule: ScheduledJobSchedule,
});
export type CreateScheduledJobInput = typeof CreateScheduledJobInput.Type;

export const UpdateScheduledJobInput = Schema.Struct({
  jobId: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  projectId: Schema.optional(ProjectId),
  prompt: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  schedule: Schema.optional(ScheduledJobSchedule),
  enabled: Schema.optional(Schema.Boolean),
});
export type UpdateScheduledJobInput = typeof UpdateScheduledJobInput.Type;

export const ScheduledJobList = Schema.Struct({
  jobs: Schema.Array(ScheduledJob),
});
export type ScheduledJobList = typeof ScheduledJobList.Type;

export const ScheduledRunList = Schema.Struct({
  runs: Schema.Array(ScheduledRun),
});
export type ScheduledRunList = typeof ScheduledRunList.Type;

export const DeleteScheduledJobInput = Schema.Struct({
  jobId: TrimmedNonEmptyString,
});
export type DeleteScheduledJobInput = typeof DeleteScheduledJobInput.Type;

export const RunScheduledJobInput = Schema.Struct({
  jobId: TrimmedNonEmptyString,
});
export type RunScheduledJobInput = typeof RunScheduledJobInput.Type;

export const ListScheduledRunsInput = Schema.Struct({
  jobId: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(Schema.Int),
});
export type ListScheduledRunsInput = typeof ListScheduledRunsInput.Type;

export class ScheduledJobError extends Schema.TaggedError<ScheduledJobError>()(
  "ScheduledJobError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
