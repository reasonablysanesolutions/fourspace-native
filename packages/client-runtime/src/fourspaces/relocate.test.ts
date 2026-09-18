import { describe, expect, it } from "vite-plus/test";

import { basenameForImport, resolveImportDestination, sanitizeFolderName } from "./relocate.ts";

describe("fourspaces import naming", () => {
  it("takes the last segment of pasted source paths", () => {
    expect(basenameForImport("/Volumes/Data/Plocka")).toBe("Plocka");
    expect(basenameForImport("/Volumes/Data/Plocka/")).toBe("Plocka");
    expect(basenameForImport("C:\\Work\\widget")).toBe("widget");
    expect(basenameForImport("  ")).toBe("");
  });

  it("neutralizes paths smuggled into folder names", () => {
    expect(sanitizeFolderName("Plocka")).toBe("Plocka");
    expect(sanitizeFolderName("  spaced name  ")).toBe("spaced name");
    expect(sanitizeFolderName("../../etc")).toBe("..-..-etc");
    expect(sanitizeFolderName("..")).toBeNull();
    expect(sanitizeFolderName("")).toBeNull();
  });

  it("resolves move/copy destinations under the kind directory", () => {
    expect(resolveImportDestination("/Volumes/Data/T3", "product", "Plocka")).toBe(
      "/Volumes/Data/T3/Products/Plocka",
    );
    expect(resolveImportDestination("~/T3/", "experiment", "ocr-test")).toBe(
      "~/T3/Experiments/ocr-test",
    );
    expect(resolveImportDestination("/T3", "project", "../evil")).toBe("/T3/Projects/..-evil");
    expect(resolveImportDestination("/T3", "project", "")).toBeNull();
  });
});
