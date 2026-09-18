// Four Spaces workspace relocation: Move / Copy an existing directory into
// a standard root. Registration (project.create/meta.update + registry row)
// stays a client composition on top of this call.
//
// Safety rules: the source must be an existing directory, the destination
// must not exist, and a directory is never moved into itself. Failures are
// typed so the UI can explain them instead of guessing.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import {
  RelocateWorkspaceError,
  type RelocateWorkspaceFailure,
  type RelocateWorkspaceInput,
  type RelocateWorkspaceResult,
} from "@t3tools/contracts";
import { expandHomePathWith } from "../pathExpansion.ts";

const statOrNull = <E>(
  fs: FileSystem.FileSystem,
  path: string,
  onError: (cause: PlatformError) => E,
): Effect.Effect<FileSystem.File.Info | null, E, FileSystem.FileSystem> =>
  fs.stat(path).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        cause.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(onError(cause)),
      onSuccess: Effect.succeed,
    }),
  );

export const relocateWorkspace = Effect.fn("FourSpaces.relocateWorkspace")(function* (
  input: RelocateWorkspaceInput,
): Effect.fn.Return<
  RelocateWorkspaceResult,
  RelocateWorkspaceError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fail = (
    failure: RelocateWorkspaceFailure,
    message: string,
    cause?: PlatformError,
  ): RelocateWorkspaceError =>
    new RelocateWorkspaceError({
      failure,
      sourcePath: input.sourcePath,
      destinationPath: input.destinationPath,
      message,
      ...(cause === undefined ? {} : { cause }),
    });

  // Tilde expansion matches project creation (WorkspacePaths): without it
  // `path.resolve` would treat `~` as a literal segment under the server cwd.
  const source = path.resolve(expandHomePathWith(input.sourcePath.trim(), path));
  const destination = path.resolve(expandHomePathWith(input.destinationPath.trim(), path));
  if (source === destination) {
    return yield* fail("destination_exists", "Source and destination are the same directory.");
  }
  const nested = path.relative(source, destination);
  if (nested !== "" && !nested.startsWith("..") && !path.isAbsolute(nested)) {
    return yield* fail("relocate_failed", "The destination cannot be inside the source directory.");
  }

  const sourceStat = yield* statOrNull(fs, source, (cause) =>
    fail("relocate_failed", "Could not read the source directory.", cause),
  );
  if (!sourceStat) {
    return yield* fail("source_missing", "The source directory does not exist.");
  }
  if (sourceStat.type !== "Directory") {
    return yield* fail("source_not_directory", "The source is not a directory.");
  }
  const destinationStat = yield* statOrNull(fs, destination, (cause) =>
    fail("relocate_failed", "Could not read the destination directory.", cause),
  );
  if (destinationStat) {
    return yield* fail(
      "destination_exists",
      "The destination already exists. Choose another folder name.",
    );
  }

  yield* fs
    .makeDirectory(path.dirname(destination), { recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        fail("relocate_failed", "Could not create the destination parent directory.", cause),
      ),
    );
  if (input.mode === "move") {
    // rename(2) is atomic but same-filesystem only: across volumes (e.g. an
    // external disk) it fails, so fall back to copy + delete. Not atomic
    // across volumes, but the destination check above still guarantees we
    // never overwrite.
    yield* fs.rename(source, destination).pipe(
      Effect.matchEffect({
        onFailure: () =>
          fs.copy(source, destination, { overwrite: false }).pipe(
            Effect.flatMap(() => fs.remove(source, { recursive: true })),
            Effect.mapError((cause) =>
              fail("relocate_failed", "Could not move the directory.", cause),
            ),
          ),
        onSuccess: () => Effect.void,
      }),
    );
  } else {
    yield* fs
      .copy(source, destination, { overwrite: false })
      .pipe(
        Effect.mapError((cause) => fail("relocate_failed", "Could not copy the directory.", cause)),
      );
  }
  return { destinationPath: destination } satisfies RelocateWorkspaceResult;
});
