import {
  hasNotesFile,
  isNotesMissingMessage,
  NOTES_AUTOSAVE_DELAY_MS,
  NOTES_FILENAME,
} from "@t3tools/client-runtime/fourspaces/notes";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { setProjectFileQueryData } from "../components/files/projectFilesQueryState";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";

export type WorkspaceNotesStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly savedAt: number | null }
  | { readonly kind: "edited" }
  | { readonly kind: "saving" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export interface WorkspaceNotes {
  readonly text: string;
  readonly status: WorkspaceNotesStatus;
  setText: (value: string) => void;
  retry: () => void;
}

/**
 * NOTES.md backing for one workspace: read once, edit locally, autosave
 * after a calm delay. The server text is displayed until the user edits, so
 * no adoption effect is needed; a later remote change while editing never
 * clobbers local text (last writer wins on save). A missing file starts
 * empty (created on first save); any other read failure blocks editing so
 * an unreadable file is never silently overwritten. The file stays plain
 * markdown any tool can open.
 */
export function useWorkspaceNotes(
  input: {
    environmentId: EnvironmentId;
    cwd: string;
  } | null,
): WorkspaceNotes {
  const query = useEnvironmentQuery(
    input
      ? projectEnvironment.readFile({
          environmentId: input.environmentId,
          input: { cwd: input.cwd, relativePath: NOTES_FILENAME },
        })
      : null,
  );
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  // User edits only; null until the first keystroke. The displayed text is
  // derived below, so remote arrivals never need an adopt effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remoteContents = query.data?.contents ?? null;
  const remoteError = query.error;
  const queryRefresh = query.refresh;
  // A read error that doesn't already look like a missing file is verified
  // against the directory listing: only a truly absent NOTES.md starts
  // empty, anything present but unreadable blocks editing.
  const needsVerify =
    input !== null &&
    remoteContents === null &&
    !!remoteError &&
    !query.isPending &&
    !isNotesMissingMessage(remoteError);
  const listing = useEnvironmentQuery(
    needsVerify && input
      ? projectEnvironment.listEntries({
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        })
      : null,
  );
  const listedMissing = listing.data ? !hasNotesFile(listing.data.entries) : null;
  // Once saved this session the file exists regardless of stale caches.
  const missing =
    lastSaved === null &&
    ((remoteContents === null &&
      !!remoteError &&
      !query.isPending &&
      isNotesMissingMessage(remoteError)) ||
      listedMissing === true);
  const blocked =
    !!remoteError &&
    !query.isPending &&
    !isNotesMissingMessage(remoteError) &&
    (listedMissing === false || !!listing.error);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // The read atom caches per dialog mount; refresh on open so a file created
  // or changed since the last visit shows up instead of stale data.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (refreshedRef.current) return;
    refreshedRef.current = true;
    queryRefresh();
  });

  const save = async (value: string) => {
    if (!input || value === lastSaved) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await writeFile({
        environmentId: input.environmentId,
        input: { cwd: input.cwd, relativePath: NOTES_FILENAME, contents: value },
      });
      if (result._tag === "Failure") {
        setSaveError("Couldn’t save notes. They’re kept here — retry.");
        return;
      }
      setLastSaved(value);
      setSavedAt(Date.now());
      // Keep the files panel and reopen snappy: seed the shared file cache.
      setProjectFileQueryData(input.environmentId, input.cwd, NOTES_FILENAME, value);
    } finally {
      setSaving(false);
    }
  };

  const setText = (value: string) => {
    setDraft(value);
    setSaveError(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(value), NOTES_AUTOSAVE_DELAY_MS);
  };

  const retry = () => {
    setSaveError(null);
    queryRefresh();
    if (draft !== null && draft !== lastSaved) void save(draft);
  };

  const text = draft ?? remoteContents ?? "";
  const dirty = draft !== null && draft !== (lastSaved ?? remoteContents);
  const loading =
    (remoteContents === null && !remoteError && (query.isPending || draft === null)) ||
    (needsVerify && listedMissing === null && !listing.error);
  const status: WorkspaceNotesStatus = useMemo(() => {
    if (blocked)
      return { kind: "error", message: listing.error ?? remoteError ?? "Couldn’t load notes." };
    if (loading) return { kind: "loading" };
    if (saveError) return { kind: "error", message: saveError };
    if (saving) return { kind: "saving" };
    if (dirty) return { kind: "edited" };
    if (missing) return { kind: "missing" };
    return { kind: "ready", savedAt };
  }, [blocked, dirty, listing.error, loading, missing, remoteError, saveError, savedAt, saving]);

  return { text, status, setText, retry };
}
