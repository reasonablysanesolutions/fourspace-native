// Workspace-scoped uploads: files land in `<root>/uploads/` and resolve
// back through every read path, while untagged uploads keep the shared dir.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ProjectId } from "@t3tools/contracts";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveAttachmentAssetPath, resolveAttachmentPath } from "../attachmentStore.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  deletePendingAttachment,
  issueAttachmentUploadUrl,
  storeAttachmentUpload,
  validateAttachmentUploadToken,
} from "./AttachmentUpload.ts";

const workspaceRoot = "/tmp/fs-upload-scope-FixtureRoot";
const shell = {
  id: ProjectId.make("11111111-1111-4111-8111-111111111111"),
  title: "Fixture",
  workspaceRoot,
  scripts: [],
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
};

const shellsLayer = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
  getProjectShells: () => Effect.succeed([shell]),
} as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]);

const testLayer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-attachment-scope-" })),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(shellsLayer),
);

const uploadInput = {
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 6,
} as const;

describe("workspace-scoped attachments", () => {
  it.effect("issues, stores, resolves and deletes inside the workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(workspaceRoot, { recursive: true });

      const issued = yield* issueAttachmentUploadUrl({ ...uploadInput, workspaceRoot });
      expect(issued.workspaceRoot).toBe(workspaceRoot);

      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      const claims = yield* validateAttachmentUploadToken(token);
      expect(claims?.workspaceRoot).toBe(workspaceRoot);

      const stored = yield* storeAttachmentUpload(claims!, new Uint8Array([1, 2, 3, 4, 5, 6]));
      expect(stored).toMatchObject({ ok: true });
      const scopedFile = path.join(workspaceRoot, "uploads", `${issued.attachmentId}.png`);
      expect(yield* fs.exists(scopedFile)).toBe(true);

      const tagged = {
        type: "image" as const,
        id: issued.attachmentId,
        name: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 6,
        workspaceRoot,
      };
      expect(resolveAttachmentPath({ attachmentsDir: "/nowhere", attachment: tagged })).toBe(
        scopedFile,
      );
      expect(
        resolveAttachmentAssetPath({
          attachmentsDir: "/nowhere",
          attachmentId: issued.attachmentId,
          workspaceRoot,
        }),
      ).toBe(scopedFile);

      yield* deletePendingAttachment(issued.attachmentId, workspaceRoot);
      expect(yield* fs.exists(scopedFile)).toBe(false);
      yield* fs.remove(workspaceRoot, { recursive: true });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("falls back to the shared dir for unknown workspaces", () =>
    Effect.gen(function* () {
      const issued = yield* issueAttachmentUploadUrl({
        ...uploadInput,
        workspaceRoot: "/definitely/not/a/project",
      });
      expect(issued.workspaceRoot).toBeUndefined();
    }).pipe(Effect.provide(testLayer)),
  );
});
