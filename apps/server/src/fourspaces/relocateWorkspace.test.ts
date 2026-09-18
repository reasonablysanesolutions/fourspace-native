import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

import { relocateWorkspace } from "./relocateWorkspace.ts";

const TestLayer = Layer.empty.pipe(Layer.provideMerge(NodeServices.layer));

const writeTree = Effect.fn("writeTree")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.join(root, "src", "nested"), { recursive: true });
  yield* fs.writeFileString(path.join(root, "README.md"), "# hello\n");
  yield* fs.writeFileString(path.join(root, "src", "index.ts"), "export const x = 1;\n");
  yield* fs.writeFileString(path.join(root, "src", "nested", "deep.txt"), "deep\n");
});

const readTree = Effect.fn("readTree")(function* (
  root: string,
): Effect.fn.Return<string[], PlatformError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const out: string[] = [];
  const walk = (dir: string): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const entries = (yield* fs.readDirectory(dir)).toSorted();
      for (const name of entries) {
        const full = path.join(dir, name);
        const stat: FileSystem.File.Info = yield* fs.stat(full);
        if (stat.type === "Directory") {
          yield* walk(full);
        } else {
          out.push(path.relative(root, full));
        }
      }
    });
  yield* walk(root);
  return out;
});

it.layer(TestLayer, { excludeTestServices: true })("relocateWorkspace", (it) => {
  describe("move", () => {
    it.effect("relocates the whole tree and removes the source", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* fs.makeTempDirectory({ prefix: "fourspaces-relocate-" });
        const source = path.join(sandbox, "origin");
        const destination = path.join(sandbox, "Products", "widget");
        yield* fs.makeDirectory(source, { recursive: true });
        yield* writeTree(source);

        const result = yield* relocateWorkspace({
          sourcePath: source,
          destinationPath: destination,
          mode: "move",
        });
        expect(result.destinationPath).toBe(destination);
        expect(yield* readTree(destination)).toEqual([
          "README.md",
          path.join("src", "index.ts"),
          path.join("src", "nested", "deep.txt"),
        ]);
        expect(
          yield* fs.stat(source).pipe(
            Effect.matchEffect({
              onFailure: (cause) =>
                cause.reason._tag === "NotFound" ? Effect.succeed("gone") : Effect.fail(cause),
              onSuccess: () => Effect.succeed("present"),
            }),
          ),
        ).toBe("gone");
      }),
    );
  });

  describe("copy", () => {
    it.effect("duplicates the tree and keeps the source", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* fs.makeTempDirectory({ prefix: "fourspaces-relocate-" });
        const source = path.join(sandbox, "origin");
        const destination = path.join(sandbox, "Experiments", "widget-copy");
        yield* fs.makeDirectory(source, { recursive: true });
        yield* writeTree(source);

        const result = yield* relocateWorkspace({
          sourcePath: source,
          destinationPath: destination,
          mode: "copy",
        });
        expect(result.destinationPath).toBe(destination);
        expect(yield* readTree(destination)).toEqual(yield* readTree(source));
      }),
    );
  });

  describe("refusals", () => {
    it.effect("reports typed failures instead of destroying anything", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* fs.makeTempDirectory({ prefix: "fourspaces-relocate-" });
        const source = path.join(sandbox, "origin");
        yield* fs.makeDirectory(source, { recursive: true });
        yield* writeTree(source);
        const file = path.join(sandbox, "file.txt");
        yield* fs.writeFileString(file, "x");

        const failureFor = (input: {
          sourcePath: string;
          destinationPath: string;
          mode: "move" | "copy";
        }) =>
          relocateWorkspace(input).pipe(
            Effect.flip,
            Effect.map((error) => error.failure ?? "untyped"),
          );

        expect(
          yield* failureFor({
            sourcePath: path.join(sandbox, "missing"),
            destinationPath: path.join(sandbox, "out"),
            mode: "move",
          }),
        ).toBe("source_missing");
        expect(
          yield* failureFor({
            sourcePath: file,
            destinationPath: path.join(sandbox, "out"),
            mode: "move",
          }),
        ).toBe("source_not_directory");
        expect(
          yield* failureFor({ sourcePath: source, destinationPath: source, mode: "move" }),
        ).toBe("destination_exists");
        expect(
          yield* failureFor({
            sourcePath: source,
            destinationPath: path.join(source, "inside"),
            mode: "move",
          }),
        ).toBe("relocate_failed");

        const occupied = path.join(sandbox, "occupied");
        yield* fs.makeDirectory(occupied, { recursive: true });
        expect(
          yield* failureFor({ sourcePath: source, destinationPath: occupied, mode: "copy" }),
        ).toBe("destination_exists");
        // The refused operations changed nothing.
        expect(yield* readTree(source)).toHaveLength(3);
      }),
    );
  });
});
