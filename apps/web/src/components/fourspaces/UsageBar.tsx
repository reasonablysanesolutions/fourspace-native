// Four Spaces global usage bar: a discreet two-line summary pinned to the
// bottom of the left rail, visible in every space.
//
// Everything is reused: subscription windows come from the same pooled
// provider snapshots as Usage → Limits, today's spend and cache share from
// the same usage-summary query as the usage page, and OpenRouter spend from
// the Four Spaces analytics RPC. Amounts from transcripts are estimates and
// the tooltip says so; OpenRouter amounts are USD as reported.
import { useAtomValue } from "@effect/atom-react";
import {
  collectLimitAccounts,
  collectLimitPools,
  formatDuration,
  type LimitPool,
} from "@t3tools/shared/usageLimits";
import { formatPercent, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useUsage } from "../../state/usage";
import { environmentPresentations } from "../../state/presentation";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { fourspacesEnvironment } from "../../state/fourspaces";
import { useEnvironmentQuery } from "../../state/query";
import { getDriverOption } from "../settings/providerDriverMeta";

function driverLabel(driver: LimitPool["driver"]): string {
  return getDriverOption(driver)?.label ?? String(driver);
}

function useTodaySpend(): { costUsd: number; cacheShare: number | null; pending: boolean } {
  const window = useMemo(() => makeWindow(1, undefined, "day"), []);
  const { merged, isPending } = useUsage(window);
  const inputTokens =
    merged.uncachedInputTokens + merged.cachedInputTokens + merged.cacheCreationTokens;
  return {
    costUsd: merged.costUsd,
    cacheShare: inputTokens > 0 ? merged.cachedInputTokens / inputTokens : null,
    pending: isPending,
  };
}

function useOpenRouterToday(
  environmentId: ReturnType<typeof usePrimaryEnvironmentId>,
): number | null {
  const query = useEnvironmentQuery(
    environmentId ? fourspacesEnvironment.openRouterUsage({ environmentId, input: {} }) : null,
  );
  const data = query.data;
  if (!data || data.status !== "configured") return null;
  return data.today.costUsd;
}

export function UsageBar() {
  const navigate = useNavigate();
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const today = useTodaySpend();
  const openRouterToday = useOpenRouterToday(primaryEnvironmentId);
  // Fixed at mount: the bar refreshes when its queries answer, which is
  // often enough for a discreet summary (no repainting timers).
  const [now] = useState(() => Date.now());

  const pool = useMemo(() => {
    const pools = collectLimitPools(collectLimitAccounts(presentations), now);
    return pools.find((candidate) => candidate.driver === "codex") ?? pools[0] ?? null;
  }, [now, presentations]);

  const window = pool?.windows[0] ?? null;
  const resetAt = window?.resets[0]?.at ?? null;
  const limitsLine =
    pool && window
      ? `${driverLabel(pool.driver)} ${Math.round(window.remainingPercent)}% left${
          resetAt ? ` · resets in ${formatDuration(resetAt - now)}` : ""
        }`
      : "Limits —";
  const spendLine = today.pending
    ? "Today …"
    : `Today ${formatUsd(today.costUsd)}${today.cacheShare !== null ? ` · Cache ${formatPercent(today.cacheShare, 0)}` : ""}${
        openRouterToday !== null ? ` · OR ${formatUsd(openRouterToday)}` : ""
      }`;

  return (
    <button
      aria-label="Open full usage. Spend is estimated from local transcripts; OpenRouter amounts are USD as reported."
      className="w-full cursor-pointer rounded-lg px-2.5 py-2 text-left outline-hidden transition-colors ring-ring hover:bg-sidebar-row-hover focus-visible:ring-2"
      onClick={() => {
        void navigate({ to: "/usage" });
      }}
      type="button"
    >
      <p className="truncate text-[11px] font-medium text-sidebar-foreground">{limitsLine}</p>
      <p className="truncate text-[11px] text-sidebar-muted-foreground">{spendLine}</p>
    </button>
  );
}
