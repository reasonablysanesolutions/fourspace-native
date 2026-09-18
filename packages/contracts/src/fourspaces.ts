// Four Spaces workspace relocation (Move / Copy into the standard roots).
//
// The registry itself stays client-side; only the privileged filesystem
// operation crosses the wire. Registration (project.create/meta.update +
// registry row) stays a client composition on top of this call.
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

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
