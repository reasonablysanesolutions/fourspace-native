import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Four Spaces scheduled jobs: automate what the user could do by hand
  // (resolve project, create/resume thread, submit a normal turn). Jobs and
  // their run history live beside the orchestration projections but outside
  // the event-sourced core: a job is configuration, not domain history.
  yield* sql`
    CREATE TABLE IF NOT EXISTS fourspaces_scheduled_jobs (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      prompt TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fourspaces_scheduled_runs (
      id TEXT NOT NULL PRIMARY KEY,
      job_id TEXT NOT NULL,
      thread_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error TEXT
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS fourspaces_scheduled_runs_job_id_started_at
      ON fourspaces_scheduled_runs (job_id, started_at)
  `;
});
