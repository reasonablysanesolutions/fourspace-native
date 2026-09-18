// Four Spaces notes: a pretty GUI over NOTES.md in the workspace root.
//
// The file is the source of truth — any editor or harness can read and
// write it, it version-controls like any other file, and losing Four Spaces
// changes nothing about it. Notes are never attached to prompts
// automatically; agents read the file when they need it.

export const NOTES_FILENAME = "NOTES.md";

/** Autosave waits this long after the last keystroke before writing. */
export const NOTES_AUTOSAVE_DELAY_MS = 1500;

/**
 * A missing NOTES.md is the normal first-open case, but the read RPC only
 * reports operation failures. Match the platform's missing-file messages as
 * a fast path; anything else is verified against the directory listing
 * before editing is allowed (never silently overwrite an unreadable file).
 */
export function isNotesMissingMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /no such file|ENOENT|not found|does not exist/i.test(message);
}

/** True when a listing contains a top-level NOTES.md file (nested ones don't count). */
export function hasNotesFile(
  entries: ReadonlyArray<{ readonly path: string; readonly kind: string }>,
): boolean {
  return entries.some(
    (entry) => entry.kind === "file" && entry.path.toLowerCase() === NOTES_FILENAME.toLowerCase(),
  );
}
