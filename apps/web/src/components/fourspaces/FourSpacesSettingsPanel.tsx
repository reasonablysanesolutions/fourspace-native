// Four Spaces settings section: per-machine standard root, default import
// behavior, and OpenRouter usage. The root and import mode live in the
// client-side workspace registry; the OpenRouter key lives in each machine's
// server secret store and spend comes live from OpenRouter's API (USD).
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type OpenRouterWindowTotals,
} from "@t3tools/contracts";
import {
  resolveDefaultImportMode,
  resolveDefaultRoot,
  type FourSpaceImportMode,
} from "@t3tools/client-runtime/fourspaces/registry";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { useState } from "react";

import { readLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { EnvironmentRow, environmentTransportLabel } from "../settings/EnvironmentRow";
import { SettingsPageContainer, SettingsSection } from "../settings/settingsLayout";
import {
  selectEnvironmentRegistry,
  useFourspacesRegistryStore,
} from "../../fourspaces/fourspacesRegistryStore";
import { useEnvironments } from "../../state/environments";
import { fourspacesEnvironment } from "../../state/fourspaces";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

const IMPORT_MODE_OPTIONS: ReadonlyArray<{ value: FourSpaceImportMode; label: string }> = [
  { value: "keep", label: "Keep in place" },
  { value: "move", label: "Move into Four Spaces" },
  { value: "copy", label: "Copy into Four Spaces" },
];

export function FourSpacesSettingsPanel() {
  const { environments } = useEnvironments();
  return (
    <SettingsPageContainer>
      <SettingsSection id="four-spaces-root" title="Standard root">
        <p className="px-4 text-[13px] text-muted-foreground sm:px-5">
          New Experiments, Projects and Products are created here. Imported workspaces may live
          anywhere.
        </p>
        {environments.map((environment) => (
          <DefaultRootRow
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label ?? environment.environmentId}
            subtitle={environmentTransportLabel(environment)}
            machineKind={resolveEnvironmentMachineKind(environment.serverConfig)}
          />
        ))}
      </SettingsSection>
      <SettingsSection id="four-spaces-import" title="Import behavior">
        {environments.map((environment) => (
          <ImportModeRow
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label ?? environment.environmentId}
            subtitle={environmentTransportLabel(environment)}
            machineKind={resolveEnvironmentMachineKind(environment.serverConfig)}
          />
        ))}
      </SettingsSection>
      <SettingsSection id="four-spaces-openrouter" title="OpenRouter usage">
        <p className="px-4 text-[13px] text-muted-foreground sm:px-5">
          Live spend from OpenRouter&apos;s own analytics API, in USD. The key is stored in this
          machine&apos;s server secret store — never in the repo or a project file. Codex and
          transcript-based spend stay separate above in Usage.
        </p>
        {environments.map((environment) => (
          <OpenRouterRow
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label ?? environment.environmentId}
            subtitle={environmentTransportLabel(environment)}
            machineKind={resolveEnvironmentMachineKind(environment.serverConfig)}
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function DefaultRootRow({
  environmentId,
  label,
  subtitle,
  machineKind,
}: {
  environmentId: EnvironmentId;
  label: string;
  subtitle: React.ReactNode;
  machineKind: Parameters<typeof EnvironmentRow>[0]["kind"];
}) {
  const registryStore = useFourspacesRegistryStore();
  const setDefaultRoot = useFourspacesRegistryStore((state) => state.setDefaultRoot);
  const registryState = selectEnvironmentRegistry(registryStore, environmentId);
  const [draft, setDraft] = useState<string | null>(null);
  const effective = resolveDefaultRoot(registryState);
  const value = draft ?? registryState.defaultRoot ?? "";
  // Commits compare against the live value, so a stale draft still resolves
  // correctly even if another client changed the root meanwhile.

  const commit = (next: string) => {
    const trimmed = next.trim();
    setDraft(null);
    if (trimmed === (registryState.defaultRoot ?? "")) return;
    setDefaultRoot(environmentId, trimmed.length === 0 ? null : trimmed);
  };

  const browse = async () => {
    try {
      const picked = await readLocalApi()?.dialogs.pickFolder(
        value.trim() ? { initialPath: value.trim() } : undefined,
      );
      if (picked) {
        setDraft(picked);
        commit(picked);
      }
    } catch {
      // Leave the text field: the user can paste a path instead.
    }
  };

  return (
    <EnvironmentRow kind={machineKind} label={label} subtitle={subtitle}>
      <div className="flex w-60 min-w-0 max-w-full flex-col items-stretch gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            aria-label={`Workspace root on ${label}`}
            className="min-w-0 flex-1 font-mono text-xs"
            onBlur={(event) => commit(event.currentTarget.value)}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value);
            }}
            placeholder="/Volumes/Mr_Jones/T3"
            value={value}
          />
          <Button onClick={() => void browse()} size="xs" type="button" variant="outline">
            Browse…
          </Button>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {effective}
          </span>
          {registryState.defaultRoot ? (
            <Button onClick={() => commit("")} size="xs" type="button" variant="ghost">
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    </EnvironmentRow>
  );
}

function ImportModeRow({
  environmentId,
  label,
  subtitle,
  machineKind,
}: {
  environmentId: EnvironmentId;
  label: string;
  subtitle: React.ReactNode;
  machineKind: Parameters<typeof EnvironmentRow>[0]["kind"];
}) {
  const registryStore = useFourspacesRegistryStore();
  const setDefaultImportMode = useFourspacesRegistryStore((state) => state.setDefaultImportMode);
  const registryState = selectEnvironmentRegistry(registryStore, environmentId);
  return (
    <EnvironmentRow kind={machineKind} label={label} subtitle={subtitle}>
      <Select
        items={IMPORT_MODE_OPTIONS}
        value={resolveDefaultImportMode(registryState)}
        onValueChange={(next) => {
          if (next) setDefaultImportMode(environmentId, next as FourSpaceImportMode);
        }}
      >
        <SelectTrigger
          size="xs"
          className="w-44"
          aria-label={`Default import location on ${label}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {IMPORT_MODE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </EnvironmentRow>
  );
}

function WindowTotalsCell({ label, totals }: { label: string; totals: OpenRouterWindowTotals }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-[13px] font-medium text-foreground">
        {formatUsd(totals.costUsd)}
      </p>
      <p className="truncate text-[11px] text-muted-foreground">
        {totals.requests} requests · {formatTokens(totals.inputTokens + totals.outputTokens)}
        {totals.cachedTokens > 0 ? ` · ${formatTokens(totals.cachedTokens)} cached` : ""}
      </p>
    </div>
  );
}

function OpenRouterRow({
  environmentId,
  label,
  subtitle,
  machineKind,
}: {
  environmentId: EnvironmentId;
  label: string;
  subtitle: React.ReactNode;
  machineKind: Parameters<typeof EnvironmentRow>[0]["kind"];
}) {
  const query = useEnvironmentQuery(
    fourspacesEnvironment.openRouterUsage({ environmentId, input: {} }),
  );
  const setKey = useAtomCommand(fourspacesEnvironment.setOpenRouterKey, { reportFailure: false });
  const clearKey = useAtomCommand(fourspacesEnvironment.clearOpenRouterKey, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;

  const save = async () => {
    if (busy) return;
    const key = draft.trim();
    if (!key) {
      setError("Paste an OpenRouter API key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await setKey({ environmentId, input: { key } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : "The key could not be saved.");
        }
        return;
      }
      setDraft("");
      query.refresh();
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await clearKey({ environmentId, input: {} });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : "The key could not be removed.");
        }
        return;
      }
      query.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnvironmentRow kind={machineKind} label={label} subtitle={subtitle}>
      <div className="flex w-full min-w-0 max-w-full flex-col items-stretch gap-2">
        {query.isPending && !data ? (
          <p className="text-xs text-muted-foreground">Loading OpenRouter usage…</p>
        ) : query.error && !data ? (
          <p className="text-xs text-destructive" role="alert">
            {query.error}
          </p>
        ) : data?.status === "error" ? (
          <p className="text-xs text-destructive" role="alert">
            {data.error ?? "OpenRouter did not answer."}
          </p>
        ) : data && data.status === "configured" ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <WindowTotalsCell label="Today (USD)" totals={data.today} />
              <WindowTotalsCell label="7 days (USD)" totals={data.last7Days} />
              <WindowTotalsCell label="30 days (USD)" totals={data.last30Days} />
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {data.keyLabel ? `Key “${data.keyLabel}”` : "Key accepted"}
              {data.creditLimit !== undefined && data.creditUsed !== undefined
                ? ` · ${formatUsd(data.creditUsed)} of ${formatUsd(data.creditLimit)} credits used`
                : ""}
            </p>
            {data.models.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {data.models.slice(0, 5).map((model) => (
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    key={model.model}
                  >
                    {model.model} · {formatUsd(model.costUsd)} · {model.requests} requests
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No OpenRouter key on this machine. Add one to see spend here and in the usage bar.
          </p>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            aria-label={`OpenRouter API key on ${label}`}
            className="min-w-0 flex-1 font-mono text-xs"
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
            }}
            placeholder="sk-or-v1-…"
            type="password"
            value={draft}
          />
          <Button disabled={busy} onClick={() => void save()} size="xs" type="button">
            {busy ? "Saving…" : "Save key"}
          </Button>
          {data?.status === "configured" || data?.status === "error" ? (
            <Button
              disabled={busy}
              onClick={() => void clear()}
              size="xs"
              type="button"
              variant="outline"
            >
              Remove
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </EnvironmentRow>
  );
}
