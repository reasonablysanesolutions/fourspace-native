// Scheduled job editor: create or edit a job that automates a normal T3
// turn (resolve project, create/resume thread, submit prompt with the
// chosen model). Runs only while the server runs.
import type { EnvironmentId, ScheduledJob, ScheduledJobSchedule } from "@t3tools/contracts";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";

export interface ScheduledJobDraft {
  title: string;
  projectId: string;
  prompt: string;
  instanceId: string;
  model: string;
  frequency: ScheduledJobSchedule["kind"];
  onceAt: string;
  dailyTime: string;
  weeklyDay: string;
  weeklyTime: string;
  intervalMinutes: string;
}

const FREQUENCIES = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "interval", label: "Interval" },
] as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function draftFromJob(job: ScheduledJob): ScheduledJobDraft {
  const schedule = job.schedule;
  return {
    title: job.title,
    projectId: job.projectId,
    prompt: job.prompt,
    instanceId: job.modelSelection.instanceId,
    model: job.modelSelection.model,
    frequency: schedule.kind,
    onceAt: schedule.atIso ? toDatetimeLocalValue(schedule.atIso) : "",
    dailyTime: `${String(schedule.hour ?? 7).padStart(2, "0")}:${String(schedule.minute ?? 0).padStart(2, "0")}`,
    weeklyDay: String(schedule.weekday ?? 1),
    weeklyTime: `${String(schedule.hour ?? 7).padStart(2, "0")}:${String(schedule.minute ?? 0).padStart(2, "0")}`,
    intervalMinutes: String(schedule.intervalMinutes ?? 60),
  };
}

export function emptyDraft(
  projectId: string,
  instanceId: string,
  model: string,
): ScheduledJobDraft {
  return {
    title: "",
    projectId,
    prompt: "",
    instanceId,
    model,
    frequency: "daily",
    onceAt: "",
    dailyTime: "07:00",
    weeklyDay: "1",
    weeklyTime: "07:00",
    intervalMinutes: "60",
  };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function buildSchedule(draft: ScheduledJobDraft): {
  schedule?: ScheduledJobSchedule;
  error?: string;
} {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  switch (draft.frequency) {
    case "once": {
      const at = new Date(draft.onceAt);
      if (!draft.onceAt || Number.isNaN(at.getTime())) return { error: "Pick a date and time." };
      if (at.getTime() <= Date.now()) return { error: "Pick a time in the future." };
      return { schedule: { kind: "once", atIso: at.toISOString() } };
    }
    case "daily": {
      const time = parseTime(draft.dailyTime);
      if (!time) return { error: "Daily time must look like 07:00." };
      return { schedule: { kind: "daily", hour: time.hour, minute: time.minute, timeZone } };
    }
    case "weekly": {
      const time = parseTime(draft.weeklyTime);
      const weekday = Number(draft.weeklyDay);
      if (!time) return { error: "Weekly time must look like 07:00." };
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        return { error: "Pick a weekday." };
      }
      return {
        schedule: { kind: "weekly", weekday, hour: time.hour, minute: time.minute, timeZone },
      };
    }
    case "interval": {
      const minutes = Number(draft.intervalMinutes);
      if (!Number.isInteger(minutes) || minutes < 5) {
        return { error: "Interval must be at least 5 minutes." };
      }
      return { schedule: { kind: "interval", intervalMinutes: minutes } };
    }
  }
}

export function ScheduledJobDialog({
  job,
  defaultProjectId,
  onSubmit,
  onClose,
}: {
  /** Null for create; the job for edit. */
  job: ScheduledJob | null;
  defaultProjectId: string | null;
  onSubmit: (draft: ScheduledJobDraft) => Promise<string | null>;
  onClose: () => void;
}) {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [draft, setDraft] = useState<ScheduledJobDraft>(() =>
    job ? draftFromJob(job) : emptyDraft(defaultProjectId ?? "", "", ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const environmentId: EnvironmentId | null =
    primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const environment = environments.find((item) => item.environmentId === environmentId) ?? null;
  const providers = environment?.serverConfig?.providers ?? [];
  // No settings scope on this route: list installed, picker-ready instances
  // with their server-reported models (custom model lists stay a
  // settings-page concern).
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(deriveProviderInstanceEntries(providers)).filter(
        isProviderInstancePickerReady,
      ),
    [providers],
  );
  const modelOptions = useMemo(
    () =>
      instanceEntries
        .find((entry) => entry.instanceId === draft.instanceId)
        ?.models.filter((model) => !model.isLegacy) ?? [],
    [instanceEntries, draft.instanceId],
  );
  // Default to the first ready instance/model so a job is one prompt away
  // from creation; explicit picks win once made.
  const effectiveInstanceId = draft.instanceId || instanceEntries[0]?.instanceId || "";
  const effectiveModelOptions = draft.instanceId
    ? modelOptions
    : (instanceEntries[0]?.models.filter((model) => !model.isLegacy) ?? []);
  const effectiveModel = draft.model || effectiveModelOptions[0]?.slug || "";
  const candidateProjects = useMemo(
    () =>
      environmentId ? projects.filter((project) => project.environmentId === environmentId) : [],
    [projects, environmentId],
  );

  const set = (patch: Partial<ScheduledJobDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!draft.title.trim()) {
      setError("Give the job a title.");
      return;
    }
    if (!draft.projectId) {
      setError("Pick a workspace for the job.");
      return;
    }
    if (!draft.prompt.trim()) {
      setError("Write the prompt the job should run.");
      return;
    }
    if (!effectiveInstanceId || !effectiveModel) {
      setError("Pick a model for the job.");
      return;
    }
    const built = buildSchedule(draft);
    if (!built.schedule) {
      setError(built.error ?? "The schedule is invalid.");
      return;
    }
    setBusy(true);
    try {
      const failure = await onSubmit({
        ...draft,
        instanceId: effectiveInstanceId,
        model: effectiveModel,
      });
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? "Edit scheduled job" : "New scheduled job"}</DialogTitle>
          <DialogDescription>
            Runs a normal T3 turn with this prompt while the server runs.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-1.5 text-[13px]">
              <span className="font-medium text-foreground">Title</span>
              <Input
                aria-label="Job title"
                onChange={(event) => set({ title: event.currentTarget.value })}
                placeholder="Morning news"
                value={draft.title}
              />
            </div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              <span className="font-medium text-foreground">Workspace</span>
              <Select
                items={candidateProjects.map((project) => ({
                  value: project.id,
                  label: project.title,
                }))}
                value={draft.projectId || null}
                onValueChange={(next) => {
                  if (next) set({ projectId: next });
                }}
              >
                <SelectTrigger aria-label="Job workspace">
                  <SelectValue placeholder="Pick a workspace" />
                </SelectTrigger>
                <SelectPopup>
                  {candidateProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              <span className="font-medium text-foreground">Prompt</span>
              <textarea
                aria-label="Job prompt"
                className="min-h-24 w-full resize-y rounded-lg border border-border/70 bg-card/40 p-3 text-[13px] leading-relaxed outline-hidden placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => set({ prompt: event.currentTarget.value })}
                placeholder="What should the agent do on each run?"
                value={draft.prompt}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Provider</span>
                <Select
                  items={instanceEntries.map((entry) => ({
                    value: entry.instanceId,
                    label: entry.displayName,
                  }))}
                  value={effectiveInstanceId || null}
                  onValueChange={(next) => {
                    if (next) {
                      const options =
                        instanceEntries
                          .find((entry) => entry.instanceId === next)
                          ?.models.filter((model) => !model.isLegacy) ?? [];
                      set({
                        instanceId: next,
                        model: options[0]?.slug ?? "",
                      });
                    }
                  }}
                >
                  <SelectTrigger aria-label="Job provider">
                    <SelectValue placeholder="Pick a provider" />
                  </SelectTrigger>
                  <SelectPopup>
                    {instanceEntries.map((entry) => (
                      <SelectItem key={entry.instanceId} value={entry.instanceId}>
                        {entry.displayName}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Model</span>
                <Select
                  items={effectiveModelOptions.map((option) => ({
                    value: option.slug,
                    label: option.name,
                  }))}
                  value={effectiveModel || null}
                  onValueChange={(next) => {
                    if (next) set({ model: next });
                  }}
                >
                  <SelectTrigger aria-label="Job model">
                    <SelectValue placeholder="Pick a model" />
                  </SelectTrigger>
                  <SelectPopup>
                    {effectiveModelOptions.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              <span className="font-medium text-foreground">Repeats</span>
              <div
                className="flex gap-1 rounded-lg bg-input/40 p-1"
                role="radiogroup"
                aria-label="Schedule frequency"
              >
                {FREQUENCIES.map((option) => (
                  <button
                    aria-pressed={draft.frequency === option.value}
                    className={
                      draft.frequency === option.value
                        ? "flex-1 cursor-pointer rounded-md bg-background px-2 py-1.5 font-medium text-foreground shadow-sm"
                        : "flex-1 cursor-pointer rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
                    }
                    key={option.value}
                    onClick={() => set({ frequency: option.value })}
                    type="button"
                    role="radio"
                    aria-checked={draft.frequency === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {draft.frequency === "once" ? (
              <div className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Date and time</span>
                <Input
                  aria-label="One-off date and time"
                  onChange={(event) => set({ onceAt: event.currentTarget.value })}
                  type="datetime-local"
                  value={draft.onceAt}
                />
              </div>
            ) : null}
            {draft.frequency === "daily" ? (
              <div className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Time of day</span>
                <Input
                  aria-label="Daily time"
                  onChange={(event) => set({ dailyTime: event.currentTarget.value })}
                  type="time"
                  value={draft.dailyTime}
                />
              </div>
            ) : null}
            {draft.frequency === "weekly" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5 text-[13px]">
                  <span className="font-medium text-foreground">Weekday</span>
                  <Select
                    items={WEEKDAYS.map((label, index) => ({ value: String(index), label }))}
                    value={draft.weeklyDay}
                    onValueChange={(next) => {
                      if (next) set({ weeklyDay: next });
                    }}
                  >
                    <SelectTrigger aria-label="Weekly weekday">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {WEEKDAYS.map((label, index) => (
                        <SelectItem key={label} value={String(index)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 text-[13px]">
                  <span className="font-medium text-foreground">Time</span>
                  <Input
                    aria-label="Weekly time"
                    onChange={(event) => set({ weeklyTime: event.currentTarget.value })}
                    type="time"
                    value={draft.weeklyTime}
                  />
                </div>
              </div>
            ) : null}
            {draft.frequency === "interval" ? (
              <div className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium text-foreground">Every (minutes, min 5)</span>
                <Input
                  aria-label="Interval minutes"
                  inputMode="numeric"
                  onChange={(event) => set({ intervalMinutes: event.currentTarget.value })}
                  value={draft.intervalMinutes}
                />
              </div>
            ) : null}
            {error ? (
              <p className="text-[13px] text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={() => void submit()} size="sm" type="button">
              {busy ? "Saving…" : job ? "Save changes" : "Create job"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
