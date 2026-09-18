// Four Spaces scheduled jobs.
//
// A job automates what the user could do by hand: resolve the workspace's T3
// project, create or resume a thread, submit a normal turn through the
// existing provider adapters. Execution reuses the orchestration engine
// directly — the same pipeline client commands travel — so scheduled turns
// are ordinary turns (streaming, checkpoints, approvals, receipts all work
// as usual; nobody needs to watch them happen).
//
// Runs only while the server runs: the tick loop lives in this process (no
// launchd/daemon in v1). Schedule math is pure and tested; persistence is a
// small side table next to — never inside — the event-sourced core.
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Schema from "effect/Schema";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ModelSelection,
  ProjectId,
  ScheduledJobSchedule,
  ThreadId,
  type ScheduledJob,
  type ScheduledRun,
  ScheduledJobError,
  type CreateScheduledJobInput,
  type UpdateScheduledJobInput,
} from "@t3tools/contracts";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";

const RUN_TIMEOUT_MS = 2 * 3_600_000;
const MIN_INTERVAL_MINUTES = 5;

// ---------------------------------------------------------------------------
// Pure schedule math (no Effect): next occurrence in milliseconds, or null
// when the schedule never fires again. Daily/weekly times are wall-clock in
// the job's timeZone (the creator's zone by default).
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
}

function zonedParts(timeZone: string, ms: number): ZonedParts | null {
  try {
    // formatToParts accepts epoch millis directly — no Date construction.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(ms);
    const get = (type: string): number => {
      const found = parts.find((part) => part.type === type)?.value;
      const n = found === undefined ? Number.NaN : Number(found);
      return Number.isFinite(n) ? n : Number.NaN;
    };
    const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "";
    const weekday = (WEEKDAY_NAMES as ReadonlyArray<string>).indexOf(weekdayName);
    const result = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      weekday,
      hour: get("hour") % 24,
      minute: get("minute"),
    };
    if (
      !Number.isInteger(result.year) ||
      !Number.isInteger(result.month) ||
      !Number.isInteger(result.day) ||
      result.weekday < 0 ||
      !Number.isInteger(result.hour) ||
      !Number.isInteger(result.minute)
    ) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

/** UTC instant of a wall-clock time in `timeZone` (iterated offset fixpoint). */
function zonedTimeToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(timeZone, guess);
    if (!parts) return null;
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const next = guess + (target - zonedAsUtc);
    if (next === guess) return guess;
    guess = next;
  }
  return guess;
}

function addDaysUtcMs(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

export function validateSchedule(schedule: ScheduledJobSchedule): string | null {
  switch (schedule.kind) {
    case "once":
      if (!schedule.atIso || Number.isNaN(Date.parse(schedule.atIso))) {
        return "Pick a date and time for the one-off run.";
      }
      return null;
    case "daily":
    case "weekly": {
      const hour = schedule.hour ?? 7;
      const minute = schedule.minute ?? 0;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "Hour must be 0–23.";
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) return "Minute must be 0–59.";
      if (schedule.kind === "weekly") {
        const weekday = schedule.weekday ?? 1;
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
          return "Weekday must be 0 (Sunday) – 6 (Saturday).";
        }
      }
      if (schedule.timeZone) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone });
        } catch {
          return "Unknown time zone.";
        }
      }
      return null;
    }
    case "interval": {
      const minutes = schedule.intervalMinutes ?? 60;
      if (!Number.isInteger(minutes) || minutes < MIN_INTERVAL_MINUTES) {
        return `Interval must be at least ${MIN_INTERVAL_MINUTES} minutes.`;
      }
      return null;
    }
  }
}

export function computeNextRunMs(
  schedule: ScheduledJobSchedule,
  fromMs: number,
  anchorMs?: number,
): number | null {
  switch (schedule.kind) {
    case "once": {
      if (!schedule.atIso) return null;
      const at = Date.parse(schedule.atIso);
      if (!Number.isFinite(at)) return null;
      return at > fromMs ? at : null;
    }
    case "interval": {
      const minutes = schedule.intervalMinutes ?? 60;
      if (!Number.isInteger(minutes) || minutes < 1) return null;
      const anchor = anchorMs ?? fromMs;
      if (anchor > fromMs) return anchor;
      const step = minutes * 60_000;
      const next = anchor + Math.ceil((fromMs - anchor + 1) / step) * step;
      return next > fromMs ? next : next + step;
    }
    case "daily":
    case "weekly": {
      const timeZone = schedule.timeZone ?? "UTC";
      const parts = zonedParts(timeZone, fromMs);
      if (!parts) return null;
      const hour = schedule.hour ?? 7;
      const minute = schedule.minute ?? 0;
      if (schedule.kind === "daily") {
        const candidate = zonedTimeToUtcMs(
          timeZone,
          parts.year,
          parts.month,
          parts.day,
          hour,
          minute,
        );
        if (candidate === null) return null;
        if (candidate > fromMs) return candidate;
        const tomorrow = zonedParts(timeZone, addDaysUtcMs(fromMs, 1));
        if (!tomorrow) return null;
        return zonedTimeToUtcMs(
          timeZone,
          tomorrow.year,
          tomorrow.month,
          tomorrow.day,
          hour,
          minute,
        );
      }
      const weekday = schedule.weekday ?? 1;
      const daysAhead = (weekday - parts.weekday + 7) % 7;
      const target = zonedParts(timeZone, addDaysUtcMs(fromMs, daysAhead));
      if (!target) return null;
      const candidate = zonedTimeToUtcMs(
        timeZone,
        target.year,
        target.month,
        target.day,
        hour,
        minute,
      );
      if (candidate === null) return null;
      if (candidate > fromMs) return candidate;
      const nextWeek = zonedParts(timeZone, addDaysUtcMs(fromMs, daysAhead + 7));
      if (!nextWeek) return null;
      return zonedTimeToUtcMs(timeZone, nextWeek.year, nextWeek.month, nextWeek.day, hour, minute);
    }
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const JobRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  projectId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  prompt: Schema.String,
  modelSelectionJson: Schema.String,
  runtimeMode: Schema.String,
  scheduleJson: Schema.String,
  enabled: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastRunAt: Schema.NullOr(Schema.String),
  nextRunAt: Schema.NullOr(Schema.String),
});

const RunRow = Schema.Struct({
  id: Schema.String,
  jobId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  status: Schema.String,
  error: Schema.NullOr(Schema.String),
});

const decodeScheduleJson = Schema.decodeUnknownOption(Schema.fromJsonString(ScheduledJobSchedule));
const decodeModelSelectionJson = Schema.decodeUnknownOption(Schema.fromJsonString(ModelSelection));
const encodeScheduleJson = Schema.encodeSync(Schema.fromJsonString(ScheduledJobSchedule));
const encodeModelSelectionJson = Schema.encodeSync(Schema.fromJsonString(ModelSelection));

function rowToJob(row: typeof JobRow.Type): ScheduledJob | null {
  const schedule = Option.getOrNull(decodeScheduleJson(row.scheduleJson));
  const modelSelection = Option.getOrNull(decodeModelSelectionJson(row.modelSelectionJson));
  if (!schedule || !modelSelection) return null;
  if (
    row.runtimeMode !== "approval-required" &&
    row.runtimeMode !== "auto-accept-edits" &&
    row.runtimeMode !== "auto" &&
    row.runtimeMode !== "full-access"
  ) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId as ProjectId,
    threadId: row.threadId as ScheduledJob["threadId"],
    prompt: row.prompt,
    modelSelection,
    runtimeMode: row.runtimeMode,
    schedule,
    enabled: row.enabled !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
  };
}

function rowToRun(row: typeof RunRow.Type): ScheduledRun | null {
  if (row.status !== "running" && row.status !== "completed" && row.status !== "failed") {
    return null;
  }
  return {
    id: row.id,
    jobId: row.jobId,
    threadId: row.threadId as ScheduledRun["threadId"],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
  };
}

const fail = (message: string, cause?: unknown): ScheduledJobError =>
  new ScheduledJobError({ message, ...(cause === undefined ? {} : { cause }) });

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScheduledJobs extends Context.Service<
  ScheduledJobs,
  {
    readonly listJobs: () => Effect.Effect<ReadonlyArray<ScheduledJob>, ScheduledJobError>;
    readonly getJob: (jobId: string) => Effect.Effect<ScheduledJob | null, ScheduledJobError>;
    readonly createJob: (
      input: CreateScheduledJobInput,
    ) => Effect.Effect<ScheduledJob, ScheduledJobError>;
    readonly updateJob: (
      input: UpdateScheduledJobInput,
    ) => Effect.Effect<ScheduledJob, ScheduledJobError>;
    readonly deleteJob: (jobId: string) => Effect.Effect<void, ScheduledJobError>;
    readonly runJobNow: (jobId: string) => Effect.Effect<ScheduledRun, ScheduledJobError>;
    readonly listRuns: (
      jobId?: string,
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<ScheduledRun>, ScheduledJobError>;
  }
>()("t3/fourspaces/scheduledJobs") {}

export const make: Effect.Effect<
  ScheduledJobs["Service"],
  never,
  | SqlClient.SqlClient
  | OrchestrationEngine.OrchestrationEngineService
  | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  | Crypto.Crypto
  | Scope.Scope
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  // randomUUIDv4 carries PlatformError; jobs speak ScheduledJobError only.
  const newId = Effect.mapError(crypto.randomUUIDv4, (cause) =>
    fail("Could not generate an id.", cause),
  );

  const listJobRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: JobRow,
    execute: () =>
      sql`
        SELECT
          id, title,
          project_id AS "projectId",
          thread_id AS "threadId",
          prompt,
          model_selection_json AS "modelSelectionJson",
          runtime_mode AS "runtimeMode",
          schedule_json AS "scheduleJson",
          enabled,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt",
          next_run_at AS "nextRunAt"
        FROM fourspaces_scheduled_jobs
        ORDER BY created_at ASC
      `,
  });

  const findJobRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String }),
    Result: JobRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id, title,
          project_id AS "projectId",
          thread_id AS "threadId",
          prompt,
          model_selection_json AS "modelSelectionJson",
          runtime_mode AS "runtimeMode",
          schedule_json AS "scheduleJson",
          enabled,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt",
          next_run_at AS "nextRunAt"
        FROM fourspaces_scheduled_jobs
        WHERE id = ${id}
      `,
  });

  const insertJobRow = SqlSchema.void({
    Request: JobRow,
    execute: (row) =>
      sql`
        INSERT INTO fourspaces_scheduled_jobs (
          id, title, project_id, thread_id, prompt, model_selection_json,
          runtime_mode, schedule_json, enabled, created_at, updated_at,
          last_run_at, next_run_at
        ) VALUES (
          ${row.id}, ${row.title}, ${row.projectId}, ${row.threadId}, ${row.prompt},
          ${row.modelSelectionJson}, ${row.runtimeMode}, ${row.scheduleJson}, ${row.enabled},
          ${row.createdAt}, ${row.updatedAt}, ${row.lastRunAt}, ${row.nextRunAt}
        )
      `,
  });

  const updateJobRow = SqlSchema.void({
    Request: JobRow,
    execute: (row) =>
      sql`
        UPDATE fourspaces_scheduled_jobs SET
          title = ${row.title},
          project_id = ${row.projectId},
          thread_id = ${row.threadId},
          prompt = ${row.prompt},
          model_selection_json = ${row.modelSelectionJson},
          runtime_mode = ${row.runtimeMode},
          schedule_json = ${row.scheduleJson},
          enabled = ${row.enabled},
          updated_at = ${row.updatedAt},
          last_run_at = ${row.lastRunAt},
          next_run_at = ${row.nextRunAt}
        WHERE id = ${row.id}
      `,
  });

  const deleteJobRow = SqlSchema.void({
    Request: Schema.Struct({ id: Schema.String }),
    execute: ({ id }) => sql`DELETE FROM fourspaces_scheduled_jobs WHERE id = ${id}`,
  });

  const deleteRunsForJob = SqlSchema.void({
    Request: Schema.Struct({ jobId: Schema.String }),
    execute: ({ jobId }) => sql`DELETE FROM fourspaces_scheduled_runs WHERE job_id = ${jobId}`,
  });

  const insertRunRow = SqlSchema.void({
    Request: RunRow,
    execute: (row) =>
      sql`
        INSERT INTO fourspaces_scheduled_runs (
          id, job_id, thread_id, started_at, finished_at, status, error
        ) VALUES (
          ${row.id}, ${row.jobId}, ${row.threadId}, ${row.startedAt},
          ${row.finishedAt}, ${row.status}, ${row.error}
        )
      `,
  });

  const updateRunRow = SqlSchema.void({
    Request: RunRow,
    execute: (row) =>
      sql`
        UPDATE fourspaces_scheduled_runs SET
          finished_at = ${row.finishedAt},
          status = ${row.status},
          error = ${row.error}
        WHERE id = ${row.id}
      `,
  });

  const listRunRows = SqlSchema.findAll({
    Request: Schema.Struct({
      jobId: Schema.NullOr(Schema.String),
      limit: Schema.Number,
    }),
    Result: RunRow,
    execute: ({ jobId, limit }) =>
      sql`
        SELECT
          id,
          job_id AS "jobId",
          thread_id AS "threadId",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          status, error
        FROM fourspaces_scheduled_runs
        WHERE (${jobId} IS NULL OR job_id = ${jobId})
        ORDER BY started_at DESC
        LIMIT ${limit}
      `,
  });

  const listRunningRunRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: RunRow,
    execute: () =>
      sql`
        SELECT
          id,
          job_id AS "jobId",
          thread_id AS "threadId",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          status, error
        FROM fourspaces_scheduled_runs
        WHERE status = 'running'
        ORDER BY started_at ASC
        LIMIT 100
      `,
  });

  const toJob = (row: typeof JobRow.Type): ScheduledJob => {
    const job = rowToJob(row);
    if (!job) {
      throw fail(`Stored scheduled job ${row.id} is corrupt and cannot be read.`);
    }
    return job;
  };

  const listJobs = Effect.fn("FourSpaces.listJobs")(function* () {
    const rows = yield* listJobRows(undefined).pipe(
      Effect.mapError((cause) => fail("Could not list scheduled jobs.", cause)),
    );
    return rows.map(toJob);
  });

  const getJob = Effect.fn("FourSpaces.getJob")(function* (jobId: string) {
    const row = yield* findJobRow({ id: jobId }).pipe(
      Effect.mapError((cause) => fail("Could not read the scheduled job.", cause)),
    );
    if (Option.isNone(row)) return null;
    return toJob(row.value);
  });

  const persistJob = Effect.fn("FourSpaces.persistJob")(function* (job: ScheduledJob) {
    const nowIso = DateTime.formatIso(yield* DateTime.now);
    const modelSelectionJson = yield* Effect.try({
      try: () => encodeModelSelectionJson(job.modelSelection),
      catch: (cause) => fail("Could not store the job model.", cause),
    });
    const scheduleJson = yield* Effect.try({
      try: () => encodeScheduleJson(job.schedule),
      catch: (cause) => fail("Could not store the job schedule.", cause),
    });
    const row: typeof JobRow.Type = {
      id: job.id,
      title: job.title,
      projectId: job.projectId,
      threadId: job.threadId,
      prompt: job.prompt,
      modelSelectionJson,
      runtimeMode: job.runtimeMode,
      scheduleJson,
      enabled: job.enabled ? 1 : 0,
      createdAt: job.createdAt,
      updatedAt: nowIso,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.nextRunAt,
    };
    const existing = yield* findJobRow({ id: job.id }).pipe(
      Effect.mapError((cause) => fail("Could not read the scheduled job.", cause)),
    );
    if (Option.isSome(existing)) {
      yield* updateJobRow(row).pipe(
        Effect.mapError((cause) => fail("Could not update the scheduled job.", cause)),
      );
    } else {
      yield* insertJobRow({ ...row, createdAt: job.createdAt }).pipe(
        Effect.mapError((cause) => fail("Could not create the scheduled job.", cause)),
      );
    }
    return { ...job, updatedAt: nowIso };
  });

  const createJob = Effect.fn("FourSpaces.createJob")(function* (input: CreateScheduledJobInput) {
    const invalid = validateSchedule(input.schedule);
    if (invalid) return yield* fail(invalid);
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const nowIso = DateTime.formatIso(now);
    const job: ScheduledJob = {
      id: yield* newId,
      title: input.title,
      projectId: input.projectId,
      threadId: null,
      prompt: input.prompt,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode ?? "full-access",
      schedule: input.schedule,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastRunAt: null,
      nextRunAt: null,
    };
    const next = computeNextRunMs(job.schedule, nowMs);
    return yield* persistJob({ ...job, nextRunAt: next === null ? null : newDateISO(next) });
  });

  const updateJob = Effect.fn("FourSpaces.updateJob")(function* (input: UpdateScheduledJobInput) {
    const current = yield* getJob(input.jobId);
    if (!current) return yield* fail("The scheduled job no longer exists.");
    const schedule = input.schedule ?? current.schedule;
    const invalid = validateSchedule(schedule);
    if (invalid) return yield* fail(invalid);
    const enabled = input.enabled ?? current.enabled;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const next = enabled ? computeNextRunMs(schedule, nowMs) : null;
    return yield* persistJob({
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      // Threads belong to one project: switching projects drops the resume link.
      ...(input.projectId !== undefined && input.projectId !== current.projectId
        ? { threadId: null }
        : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
      schedule,
      enabled,
      nextRunAt: next === null ? null : newDateISO(next),
    });
  });

  const deleteJob = Effect.fn("FourSpaces.deleteJob")(function* (jobId: string) {
    yield* deleteRunsForJob({ jobId }).pipe(
      Effect.mapError((cause) => fail("Could not delete the scheduled job.", cause)),
    );
    yield* deleteJobRow({ id: jobId }).pipe(
      Effect.mapError((cause) => fail("Could not delete the scheduled job.", cause)),
    );
  });

  const recordRun = Effect.fn("FourSpaces.recordRun")(function* (run: ScheduledRun) {
    yield* insertRunRow({
      id: run.id,
      jobId: run.jobId,
      threadId: run.threadId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      error: run.error ?? null,
    }).pipe(Effect.mapError((cause) => fail("Could not record the scheduled run.", cause)));
    return run;
  });

  const resolveThread = Effect.fn("FourSpaces.resolveThread")(function* (
    job: ScheduledJob,
    nowIso: string,
  ) {
    if (job.threadId) {
      const shell = yield* snapshots
        .getThreadShellById(job.threadId)
        .pipe(Effect.mapError((cause) => fail("Could not read the job thread.", cause)));
      if (Option.isSome(shell)) return job.threadId;
    }
    const threadId = ThreadId.make(yield* newId);
    yield* engine
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(yield* newId),
        threadId,
        projectId: job.projectId,
        title: job.title,
        modelSelection: job.modelSelection,
        runtimeMode: job.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: nowIso,
      })
      .pipe(Effect.mapError((cause) => fail("Could not create the job thread.", cause)));
    return threadId;
  });

  const executeJob = Effect.fn("FourSpaces.executeJob")(function* (
    job: ScheduledJob,
    nowMs: number,
    nowIso: string,
  ) {
    const project = yield* snapshots
      .getProjectShellById(job.projectId)
      .pipe(Effect.mapError((cause) => fail("Could not read the job workspace.", cause)));
    if (Option.isNone(project)) {
      return yield* fail(`The workspace for “${job.title}” no longer exists.`);
    }
    const threadId = yield* resolveThread(job, nowIso);
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(yield* newId),
        threadId,
        message: {
          messageId: MessageId.make(yield* newId),
          role: "user",
          text: job.prompt,
          attachments: [],
        },
        modelSelection: job.modelSelection,
        runtimeMode: job.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: nowIso,
      })
      .pipe(Effect.mapError((cause) => fail("Could not start the scheduled turn.", cause)));
    const run: ScheduledRun = {
      id: yield* newId,
      jobId: job.id,
      threadId,
      startedAt: nowIso,
      finishedAt: null,
      status: "running",
    };
    yield* recordRun(run);
    const next = job.schedule.kind === "once" ? null : computeNextRunMs(job.schedule, nowMs);
    yield* persistJob({
      ...job,
      threadId,
      lastRunAt: nowIso,
      nextRunAt: next === null ? null : newDateISO(next),
      ...(job.schedule.kind === "once" ? { enabled: false } : {}),
    });
    return run;
  });

  const runJobNow = Effect.fn("FourSpaces.runJobNow")(function* (jobId: string) {
    const job = yield* getJob(jobId);
    if (!job) return yield* fail("The scheduled job no longer exists.");
    const now = yield* DateTime.now;
    return yield* executeJob(job, DateTime.toEpochMillis(now), DateTime.formatIso(now));
  });

  const listRuns = Effect.fn("FourSpaces.listRuns")(function* (jobId?: string, limit?: number) {
    const rows = yield* listRunRows({
      jobId: jobId ?? null,
      limit: Math.max(1, Math.min(200, Math.floor(limit ?? 50))),
    }).pipe(Effect.mapError((cause) => fail("Could not list scheduled runs.", cause)));
    return rows.flatMap((row) => {
      const run = rowToRun(row);
      return run ? [run] : [];
    });
  });

  const sweepRunningRuns = Effect.fn("FourSpaces.sweepRunningRuns")(function* (nowMs: number) {
    const rows = yield* listRunningRunRows(undefined).pipe(
      Effect.catchCause(() => Effect.succeed([])),
    );
    for (const row of rows) {
      const run = rowToRun(row);
      if (!run) continue;
      if (!run.threadId) {
        yield* updateRunRow({
          ...row,
          finishedAt: newDateISO(nowMs),
          status: "failed",
          error: "The run never reached a thread.",
        }).pipe(Effect.ignore);
        continue;
      }
      if (nowMs - Date.parse(run.startedAt) > RUN_TIMEOUT_MS) {
        yield* updateRunRow({
          ...row,
          finishedAt: newDateISO(nowMs),
          status: "failed",
          error: "The run timed out after 2 hours.",
        }).pipe(Effect.ignore);
        continue;
      }
      const shell = yield* snapshots
        .getThreadShellById(run.threadId)
        .pipe(Effect.catchCause(() => Effect.succeedNone));
      if (Option.isNone(shell)) {
        yield* updateRunRow({
          ...row,
          finishedAt: newDateISO(nowMs),
          status: "failed",
          error: "The thread is gone.",
        }).pipe(Effect.ignore);
        continue;
      }
      const latest = shell.value.latestTurn;
      if (!latest || latest.requestedAt < run.startedAt) continue;
      if (latest.state === "completed") {
        yield* updateRunRow({
          ...row,
          finishedAt: latest.completedAt ?? newDateISO(nowMs),
          status: "completed",
          error: null,
        }).pipe(Effect.ignore);
      } else if (latest.state === "error" || latest.state === "interrupted") {
        yield* updateRunRow({
          ...row,
          finishedAt: latest.completedAt ?? newDateISO(nowMs),
          status: "failed",
          error: latest.state === "error" ? "The turn failed." : "The turn was interrupted.",
        }).pipe(Effect.ignore);
      }
    }
  });

  const tick = Effect.fn("FourSpaces.tick")(function* () {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const jobs = yield* listJobs().pipe(Effect.catchCause(() => Effect.succeed([])));
    for (const job of jobs) {
      if (!job.enabled || !job.nextRunAt) continue;
      if (Date.parse(job.nextRunAt) > nowMs) continue;
      // Claim the next slot before executing so a slow turn never double-fires.
      const claimed: ScheduledJob = {
        ...job,
        nextRunAt:
          job.schedule.kind === "once"
            ? null
            : (() => {
                const next = computeNextRunMs(job.schedule, nowMs);
                return next === null ? null : newDateISO(next);
              })(),
        ...(job.schedule.kind === "once" ? { enabled: false } : {}),
      };
      yield* persistJob(claimed).pipe(Effect.ignore);
      const nowIso = DateTime.formatIso(yield* DateTime.now);
      yield* executeJob(claimed, nowMs, nowIso).pipe(
        Effect.catchCause((cause) =>
          recordRun({
            id: `${claimed.id}:${nowMs}`,
            jobId: claimed.id,
            threadId: claimed.threadId,
            startedAt: nowIso,
            finishedAt: nowIso,
            status: "failed",
            ...(Schema.is(ScheduledJobError)(cause) || cause instanceof Error
              ? { error: cause.message.slice(0, 500) }
              : {}),
          }).pipe(Effect.ignore),
        ),
      );
    }
    yield* sweepRunningRuns(nowMs);
  });

  yield* forkParked(
    tick().pipe(
      Effect.catchCause((cause) => Effect.logWarning("scheduled jobs tick failed", { cause })),
      Effect.repeat(Schedule.spaced(Duration.millis(30_000))),
      Effect.asVoid,
    ),
  );

  return {
    listJobs: () => listJobs(),
    getJob: (jobId: string) => getJob(jobId),
    createJob: (input: CreateScheduledJobInput) => createJob(input),
    updateJob: (input: UpdateScheduledJobInput) => updateJob(input),
    deleteJob: (jobId: string) => deleteJob(jobId),
    runJobNow: (jobId: string) => runJobNow(jobId),
    listRuns: (jobId?: string, limit?: number) => listRuns(jobId, limit),
  } satisfies ScheduledJobs["Service"];
});

export const layer = Layer.effect(ScheduledJobs, make);

// ISO helper: DateTime.formatIso needs a DateTime; epoch millis convert here
// (pure, outside Effect) so service code stays Clock-based.
function newDateISO(ms: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(ms));
}
