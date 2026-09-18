// Four Spaces workspace relocation (Move / Copy into the standard roots).
//
// The registry itself stays client-side; only the privileged filesystem
// operation crosses the wire. Registration (project.create/meta.update +
// registry row) stays a client composition on top of this call.
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

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
