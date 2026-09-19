import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import {
  chatWorkspaceRootFor,
  emptyEnvironmentState,
  findWorkspaceEntry,
  readEnvironmentState,
  removeWorkspaceEntriesForProject,
  removeWorkspaceEntry,
  resolveChatProjectId,
  resolveDefaultImportMode,
  resolveDefaultRoot,
  resolveOriginProductRef,
  resolveOriginProductTitle,
  resolveProjectSpace,
  sanitizeEnvironmentState,
  sanitizeRegistry,
  selectOrganizedWorkspaces,
  selectProjectsForSpace,
  selectUnsortedProjects,
  selectVisibleProjects,
  setDefaultImportMode,
  setChatProjectId,
  setDefaultRoot,
  upsertWorkspaceEntry,
  type FourSpacesEnvironmentState,
  type FourSpacesWorkspaceEntry,
} from "./registry.ts";

const environmentId = EnvironmentId.make("env-1");

function entry(overrides: Partial<FourSpacesWorkspaceEntry> = {}): FourSpacesWorkspaceEntry {
  return {
    workspaceId: "ws-1",
    workspaceRoot: "/work/alpha",
    projectId: "project-1",
    kind: "experiment",
    ...overrides,
  };
}

function project(id: string, workspaceRoot: string) {
  return { id, workspaceRoot, environmentId };
}

function titledProject(id: string, workspaceRoot: string, title: string) {
  return { ...project(id, workspaceRoot), title };
}

describe("fourspaces registry", () => {
  it("starts empty with an unset default root", () => {
    const state = emptyEnvironmentState();
    expect(state.entries).toEqual([]);
    expect(state.chatProjectId).toBeNull();
    expect(resolveDefaultRoot(state)).toBe("~/T3");
    expect(chatWorkspaceRootFor(resolveDefaultRoot(state))).toBe("~/T3/Chat");
  });

  it("repairs persisted garbage instead of throwing", () => {
    expect(sanitizeRegistry(null)).toEqual({});
    expect(sanitizeRegistry([])).toEqual({});
    expect(sanitizeRegistry({ [environmentId]: null })).toEqual({
      [environmentId]: emptyEnvironmentState(),
    });
    const repaired = sanitizeEnvironmentState({
      defaultRoot: 42,
      chatProjectId: "",
      entries: [
        entry(),
        { workspaceId: "", workspaceRoot: "/x", kind: "experiment" },
        { workspaceId: "ws-1", workspaceRoot: "/other", kind: "experiment" },
        { workspaceId: "ws-2", workspaceRoot: "/y", kind: "nope" },
        "garbage",
      ],
    });
    expect(repaired.defaultRoot).toBeNull();
    expect(repaired.chatProjectId).toBeNull();
    expect(repaired.entries).toEqual([entry()]);
  });

  it("upserts entries by workspace id and removes them", () => {
    let state = emptyEnvironmentState();
    state = upsertWorkspaceEntry(state, entry());
    state = upsertWorkspaceEntry(state, entry({ kind: "product" }));
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.kind).toBe("product");
    state = upsertWorkspaceEntry(state, entry({ workspaceId: "ws-2", kind: "project" }));
    expect(state.entries).toHaveLength(2);
    state = removeWorkspaceEntry(state, "missing");
    expect(state.entries).toHaveLength(2);
    state = removeWorkspaceEntry(state, "ws-1");
    expect(state.entries.map((item) => item.workspaceId)).toEqual(["ws-2"]);
    state = removeWorkspaceEntriesForProject(
      upsertWorkspaceEntry(state, entry({ workspaceId: "ws-3", projectId: "project-9" })),
      "project-9",
    );
    expect(state.entries.map((item) => item.workspaceId)).toEqual(["ws-2"]);
  });

  it("rejects malformed upserts without touching state", () => {
    const state = upsertWorkspaceEntry(emptyEnvironmentState(), entry());
    expect(upsertWorkspaceEntry(state, { ...entry(), kind: "chat" } as never)).toBe(state);
    expect(upsertWorkspaceEntry(state, { ...entry(), workspaceId: "" })).toBe(state);
  });

  it("finds entries by project id first, then by normalized root", () => {
    const state = upsertWorkspaceEntry(
      upsertWorkspaceEntry(emptyEnvironmentState(), entry()),
      entry({ workspaceId: "ws-2", workspaceRoot: "/work/beta/", projectId: null }),
    );
    expect(
      findWorkspaceEntry(state, { id: "project-1", workspaceRoot: "/moved" })?.workspaceId,
    ).toBe("ws-1");
    expect(
      findWorkspaceEntry(state, { id: "other", workspaceRoot: "/work/beta" })?.workspaceId,
    ).toBe("ws-2");
    expect(findWorkspaceEntry(state, { id: "other", workspaceRoot: "/work/gamma" })).toBeNull();
  });

  it("resolves the chat backing project by stored id, then by chat root", () => {
    const projects = [project("p-chat", "/Users/me/T3/Chat"), project("p-other", "/other")];
    const base: FourSpacesEnvironmentState = {
      ...emptyEnvironmentState(),
      defaultRoot: "/Users/me/T3",
    };
    expect(resolveChatProjectId({ projects, environmentId, state: base })).toBe("p-chat");
    const stored = setChatProjectId(base, "p-other");
    expect(resolveChatProjectId({ projects, environmentId, state: stored })).toBe("p-other");
    // A stale stored id falls back to the chat root instead of pointing nowhere.
    const stale = setChatProjectId(base, "gone");
    expect(resolveChatProjectId({ projects, environmentId, state: stale })).toBe("p-chat");
    expect(
      resolveChatProjectId({
        projects: [project("p-other", "/other")],
        environmentId,
        state: base,
      }),
    ).toBeNull();
  });

  it("skips session-dead roots instead of re-adopting them", () => {
    const projects = [project("p-chat", "/Users/me/T3/Chat")];
    expect(
      resolveChatProjectId({
        projects,
        environmentId,
        state: emptyEnvironmentState(),
        excludeRoots: new Set(["/Users/me/T3/Chat"]),
      }),
    ).toBeNull();
    expect(
      resolveChatProjectId({
        projects,
        environmentId,
        state: emptyEnvironmentState(),
        excludeRoots: new Set(["/elsewhere"]),
      }),
    ).toBe("p-chat");
  });

  it("keeps unclassified projects visible in kind spaces, chat isolated", () => {
    const projects = [
      project("p-exp", "/work/exp"),
      project("p-prod", "/work/prod"),
      project("p-new", "/work/new"),
      project("p-chat", "/Users/me/T3/Chat"),
    ];
    let state: FourSpacesEnvironmentState = {
      ...emptyEnvironmentState(),
      defaultRoot: "/Users/me/T3",
      chatProjectId: "p-chat",
    };
    state = upsertWorkspaceEntry(
      state,
      entry({
        workspaceId: "w-exp",
        workspaceRoot: "/work/exp",
        projectId: "p-exp",
        kind: "experiment",
      }),
    );
    state = upsertWorkspaceEntry(
      state,
      entry({
        workspaceId: "w-prod",
        workspaceRoot: "/work/prod",
        projectId: "p-prod",
        kind: "product",
      }),
    );

    const ids = (space: "chat" | "experiment" | "project" | "product") =>
      selectProjectsForSpace(projects, environmentId, state, space).map((item) => item.id);
    expect(ids("chat")).toEqual(["p-chat"]);
    expect(ids("experiment")).toEqual(["p-exp", "p-new"]);
    expect(ids("product")).toEqual(["p-prod", "p-new"]);
    expect(ids("project")).toEqual(["p-new"]);

    expect(
      resolveProjectSpace(state, { id: "p-chat", workspaceRoot: "/Users/me/T3/Chat" }, "p-chat"),
    ).toBe("chat");
    expect(resolveProjectSpace(state, { id: "p-exp", workspaceRoot: "/work/exp" }, "p-chat")).toBe(
      "experiment",
    );
    expect(
      resolveProjectSpace(state, { id: "p-new", workspaceRoot: "/work/new" }, "p-chat"),
    ).toBeNull();
  });

  it("adopts a home-expanded chat root under the default layout", () => {
    const projects = [project("p-chat", "/Users/me/T3/Chat")];
    // Default root is ~/T3; the server stores /Users/me/T3/Chat, which never
    // string-matches — the T3/Chat tail still adopts it.
    expect(resolveChatProjectId({ projects, environmentId, state: emptyEnvironmentState() })).toBe(
      "p-chat",
    );
    // An explicit custom root disables the tail heuristic: no false adoption.
    const custom: FourSpacesEnvironmentState = {
      ...emptyEnvironmentState(),
      defaultRoot: "/Volumes/Data/T3",
    };
    expect(resolveChatProjectId({ projects, environmentId, state: custom })).toBeNull();
  });

  it("fans visible projects out across environments", () => {
    const other = EnvironmentId.make("env-2");
    const projects = [{ ...project("p1", "/a"), environmentId: other }, project("p2", "/b")];
    const registry = {
      [environmentId]: emptyEnvironmentState(),
      [other]: emptyEnvironmentState(),
    };
    expect(selectVisibleProjects(projects, registry, "experiment").map((item) => item.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(selectVisibleProjects(projects, registry, "chat")).toEqual([]);
  });

  it("resolves the origin product title for experiments", () => {
    const projects = [
      titledProject("p-prod", "/work/plocka", "Plocka"),
      titledProject("p-exp", "/work/ocr", "OCR test"),
      titledProject("p-lone", "/work/lone", "Lone"),
    ];
    let state = upsertWorkspaceEntry(emptyEnvironmentState(), {
      workspaceId: "prod",
      workspaceRoot: "/work/plocka",
      projectId: "p-prod",
      kind: "product",
    });
    state = upsertWorkspaceEntry(state, {
      workspaceId: "exp",
      workspaceRoot: "/work/ocr",
      projectId: "p-exp",
      kind: "experiment",
      originProductId: "prod",
    });
    expect(
      resolveOriginProductTitle(projects, state, { id: "p-exp", workspaceRoot: "/work/ocr" }),
    ).toBe("Plocka");
    expect(
      resolveOriginProductTitle(projects, state, { id: "p-lone", workspaceRoot: "/work/lone" }),
    ).toBeNull();
    // Origin entry without a linked project still resolves by root.
    const rootOnly = upsertWorkspaceEntry(emptyEnvironmentState(), {
      workspaceId: "prod2",
      workspaceRoot: "/work/plocka",
      kind: "product",
    });
    const withExp = upsertWorkspaceEntry(rootOnly, {
      workspaceId: "exp2",
      workspaceRoot: "/work/ocr",
      projectId: "p-exp",
      kind: "experiment",
      originProductId: "prod2",
    });
    expect(
      resolveOriginProductTitle(projects, withExp, { id: "p-exp", workspaceRoot: "/work/ocr" }),
    ).toBe("Plocka");
    expect(
      resolveOriginProductRef(projects, withExp, { id: "p-exp", workspaceRoot: "/work/ocr" })?.id,
    ).toBe("p-prod");
    expect(
      resolveOriginProductRef(projects, withExp, { id: "p-lone", workspaceRoot: "/work/lone" }),
    ).toBeNull();
  });

  it("lists unsorted projects excluding classified and chat projects", () => {
    const projects = [
      project("p-exp", "/work/exp"),
      project("p-new", "/work/new"),
      project("p-chat", "/Users/me/T3/Chat"),
    ];
    const state: FourSpacesEnvironmentState = {
      ...emptyEnvironmentState(),
      defaultRoot: "/Users/me/T3",
      chatProjectId: "p-chat",
    };
    const classified = upsertWorkspaceEntry(
      state,
      entry({
        workspaceId: "w-exp",
        workspaceRoot: "/work/exp",
        projectId: "p-exp",
        kind: "experiment",
      }),
    );
    expect(
      selectUnsortedProjects(projects, environmentId, classified).map((item) => item.id),
    ).toEqual(["p-new"]);
    // Without classification everything but the adopted chat project is unsorted.
    expect(
      selectUnsortedProjects(projects, environmentId, emptyEnvironmentState()).map(
        (item) => item.id,
      ),
    ).toEqual(["p-exp", "p-new"]);
  });

  it("lists organized workspaces sorted by root, even without a live project", () => {
    let state = emptyEnvironmentState();
    state = upsertWorkspaceEntry(state, entry({ workspaceId: "w-b", workspaceRoot: "/work/b" }));
    state = upsertWorkspaceEntry(
      state,
      entry({ workspaceId: "w-a", workspaceRoot: "/work/a", kind: "product" }),
    );
    state = upsertWorkspaceEntry(
      state,
      entry({ workspaceId: "w-gone", workspaceRoot: "/work/gone", projectId: null }),
    );
    expect(selectOrganizedWorkspaces(state).map((item) => item.entry.workspaceId)).toEqual([
      "w-a",
      "w-b",
      "w-gone",
    ]);
    expect(selectOrganizedWorkspaces(state)[2]?.projectId).toBeNull();
    expect(selectOrganizedWorkspaces(emptyEnvironmentState())).toEqual([]);
  });

  it("round-trips the default import mode with keep as fallback", () => {
    expect(resolveDefaultImportMode(emptyEnvironmentState())).toBe("keep");
    const state = setDefaultImportMode(emptyEnvironmentState(), "copy");
    expect(resolveDefaultImportMode(state)).toBe("copy");
    expect(setDefaultImportMode(state, "copy")).toBe(state);
    expect(resolveDefaultImportMode(setDefaultImportMode(state, null))).toBe("keep");
    expect(
      sanitizeEnvironmentState({ ...state, defaultImportMode: "teleport" }).defaultImportMode,
    ).toBeNull();
  });

  it("reads per-environment registries and honors default root overrides", () => {
    const registry = sanitizeRegistry({
      [environmentId]: { defaultRoot: "/Volumes/Data/T3", entries: [] },
    });
    const state = readEnvironmentState(registry, environmentId);
    expect(resolveDefaultRoot(state)).toBe("/Volumes/Data/T3");
    expect(chatWorkspaceRootFor(resolveDefaultRoot(state))).toBe("/Volumes/Data/T3/Chat");
    expect(setDefaultRoot(state, "  ").defaultRoot).toBeNull();
    expect(readEnvironmentState(registry, EnvironmentId.make("missing"))).toEqual(
      emptyEnvironmentState(),
    );
  });
});
