// Four Spaces settings section: per-machine standard root and default
// import behavior. Stored in the client-side workspace registry (per
// environment), next to the classification it configures — no server
// settings involved.
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import {
  resolveDefaultImportMode,
  resolveDefaultRoot,
  type FourSpaceImportMode,
} from "@t3tools/client-runtime/fourspaces/registry";
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
import type { EnvironmentId } from "@t3tools/contracts";

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
            placeholder="~/T3"
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
