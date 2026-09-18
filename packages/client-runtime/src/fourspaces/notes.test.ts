import { describe, expect, it } from "vite-plus/test";

import {
  hasNotesFile,
  isNotesMissingMessage,
  NOTES_AUTOSAVE_DELAY_MS,
  NOTES_FILENAME,
} from "./notes.ts";

describe("fourspaces notes", () => {
  it("lives in NOTES.md with a calm autosave delay", () => {
    expect(NOTES_FILENAME).toBe("NOTES.md");
    expect(NOTES_AUTOSAVE_DELAY_MS).toBeGreaterThanOrEqual(1000);
  });

  it("recognizes a missing file but nothing else", () => {
    expect(isNotesMissingMessage(null)).toBe(false);
    expect(isNotesMissingMessage("")).toBe(false);
    expect(isNotesMissingMessage("Error: ENOENT: no such file or directory")).toBe(true);
    expect(isNotesMissingMessage("No such file '/x/NOTES.md'")).toBe(true);
    expect(isNotesMissingMessage("Permission denied")).toBe(false);
    expect(isNotesMissingMessage("Binary file")).toBe(false);
  });

  it("finds a top-level NOTES.md file in listings", () => {
    expect(hasNotesFile([])).toBe(false);
    expect(hasNotesFile([{ path: "README.md", kind: "file" }])).toBe(false);
    expect(hasNotesFile([{ path: "NOTES.md", kind: "file" }])).toBe(true);
    expect(hasNotesFile([{ path: "notes.md", kind: "file" }])).toBe(true);
    expect(hasNotesFile([{ path: "docs/NOTES.md", kind: "file" }])).toBe(false);
    expect(hasNotesFile([{ path: "NOTES.md", kind: "directory" }])).toBe(false);
  });
});
