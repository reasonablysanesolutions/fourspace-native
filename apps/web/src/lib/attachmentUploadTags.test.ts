import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getUploadedAttachments, useAttachmentUploadStore } from "./attachmentUploadQueue";
import type { ComposerImageAttachment } from "../composerDraftStore";

const environmentId = EnvironmentId.make("environment-1");

function image(id: string): ComposerImageAttachment {
  return {
    type: "image",
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    previewUrl: "blob:preview",
    file: new File(["x"], `${id}.png`, { type: "image/png" }),
  };
}

describe("getUploadedAttachments workspace tags", () => {
  it("carries the scoped root onto message attachments", () => {
    useAttachmentUploadStore.setState({
      uploadsByImageId: {
        "image-1": {
          status: "ready",
          environmentId,
          attachmentId: "pending-1",
          workspaceRoot: "/Volumes/Mr_Jones/T3/Chat",
        },
      },
    });
    const attachments = getUploadedAttachments({ environmentId, images: [image("image-1")] });
    expect(attachments?.[0]).toMatchObject({
      id: "pending-1",
      workspaceRoot: "/Volumes/Mr_Jones/T3/Chat",
    });
    useAttachmentUploadStore.setState({ uploadsByImageId: {} });
  });

  it("omits the tag for shared-dir uploads", () => {
    useAttachmentUploadStore.setState({
      uploadsByImageId: {
        "image-1": {
          status: "ready",
          environmentId,
          attachmentId: "pending-1",
          workspaceRoot: null,
        },
      },
    });
    const attachments = getUploadedAttachments({ environmentId, images: [image("image-1")] });
    expect(attachments?.[0]).not.toHaveProperty("workspaceRoot");
    useAttachmentUploadStore.setState({ uploadsByImageId: {} });
  });
});
