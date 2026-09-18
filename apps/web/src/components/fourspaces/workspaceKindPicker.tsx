import type { FourSpaceKind } from "@t3tools/client-runtime/fourspaces/registry";

import { FOURSPACE_LABELS } from "../../fourspaces/spaces";

export const KIND_OPTIONS: ReadonlyArray<FourSpaceKind> = ["experiment", "project", "product"];

export function KindPicker({
  value,
  onChange,
}: {
  value: FourSpaceKind;
  onChange: (value: FourSpaceKind) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <span className="font-medium text-foreground">Type</span>
      <div
        className="flex gap-1 rounded-lg bg-input/40 p-1"
        role="radiogroup"
        aria-label="Workspace type"
      >
        {KIND_OPTIONS.map((kind) => (
          <button
            aria-pressed={value === kind}
            className={
              value === kind
                ? "flex-1 cursor-pointer rounded-md bg-background px-2 py-1.5 font-medium text-foreground shadow-sm"
                : "flex-1 cursor-pointer rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground"
            }
            key={kind}
            onClick={() => onChange(kind)}
            type="button"
            role="radio"
            aria-checked={value === kind}
          >
            {FOURSPACE_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
