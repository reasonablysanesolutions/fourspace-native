import { describe, expect, it } from "vite-plus/test";

import {
  buildProductContext,
  PRODUCT_CONTEXT_SOURCES,
  selectRelatedExperiments,
} from "./productContext.ts";
import { emptyEnvironmentState, upsertWorkspaceEntry } from "./registry.ts";

describe("fourspaces product context", () => {
  it("consults readme, agents, notes and memory", () => {
    expect(PRODUCT_CONTEXT_SOURCES).toEqual([
      "README.md",
      "AGENTS.md",
      "NOTES.md",
      "product-memory.md",
    ]);
  });

  it("builds a compact snapshot and skips the rest", () => {
    const body = buildProductContext({
      productTitle: "Plocka",
      productRoot: "/work/plocka",
      experimentName: "ocr-test",
      createdAt: "2026-09-18",
      sources: [
        { path: "README.md", contents: "# Plocka\n\nPick orders.\n" },
        { path: "AGENTS.md", contents: null },
        { path: "NOTES.md", contents: "   " },
        { path: "product-memory.md", contents: "Uses GPS.\n" },
      ],
    });
    expect(body).toContain("# Product context: Plocka");
    expect(body).toContain("ocr-test");
    expect(body).toContain("## From README.md");
    expect(body).toContain("## From product-memory.md");
    expect(body).not.toContain("AGENTS.md");
    expect(body).not.toContain("## From NOTES.md");
  });

  it("returns null when no source has anything to say", () => {
    expect(
      buildProductContext({
        productTitle: "Plocka",
        productRoot: "/work/plocka",
        experimentName: "ocr-test",
        createdAt: "2026-09-18",
        sources: [
          { path: "README.md", contents: null },
          { path: "NOTES.md", contents: "" },
        ],
      }),
    ).toBeNull();
  });

  it("truncates giant sources instead of dumping them", () => {
    const body = buildProductContext({
      productTitle: "Plocka",
      productRoot: "/work/plocka",
      experimentName: "ocr-test",
      createdAt: "2026-09-18",
      sources: [{ path: "README.md", contents: `x\n`.repeat(5000) }],
    });
    expect(body?.length).toBeLessThan(7000);
    expect(body).toContain("truncated");
  });

  it("lists related experiments for a product", () => {
    let state = emptyEnvironmentState();
    state = upsertWorkspaceEntry(state, {
      workspaceId: "prod",
      workspaceRoot: "/work/plocka",
      projectId: "p-prod",
      kind: "product",
    });
    state = upsertWorkspaceEntry(state, {
      workspaceId: "exp-1",
      workspaceRoot: "/work/ocr",
      projectId: "p-exp-1",
      kind: "experiment",
      originProductId: "prod",
    });
    state = upsertWorkspaceEntry(state, {
      workspaceId: "exp-2",
      workspaceRoot: "/work/other",
      projectId: "p-exp-2",
      kind: "experiment",
    });
    expect(selectRelatedExperiments(state, "prod").map((item) => item.workspaceId)).toEqual([
      "exp-1",
    ]);
    expect(selectRelatedExperiments(state, "missing")).toEqual([]);
  });
});
