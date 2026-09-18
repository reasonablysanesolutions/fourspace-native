// Four Spaces OpenRouter usage/analytics.
//
// Reads live from OpenRouter's own API (`/auth/key`, `/credits`,
// `/activity`) with a key the user stores in the server secret store —
// never in the repo or in project files. Results are cached in memory for a
// few minutes; amounts are USD as reported and the UI must label them so.
//
// The `/activity` rows are parsed defensively: OpenRouter may add fields or
// omit token breakdowns per row, so every number defaults to zero instead of
// failing the whole read.
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Option from "effect/Option";
import {
  OpenRouterUsageError,
  type OpenRouterModelTotals,
  type OpenRouterUsageResult,
  type OpenRouterWindowTotals,
} from "@t3tools/contracts";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";

const SECRET_NAME = "fourspaces.openrouter_api_key";
const API_BASE = "https://openrouter.ai/api/v1";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_MODELS = 8;

export interface OpenRouterActivityRow {
  readonly date: string;
  readonly model: string;
  readonly costUsd: number;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
}

const EMPTY_WINDOW: OpenRouterWindowTotals = {
  costUsd: 0,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
};

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asInt(value: unknown): number {
  const n = asNumber(value);
  return n < 0 ? 0 : Math.floor(n);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Normalize one raw `/activity` row; unknown shapes become zero rows, never throws. */
export function normalizeActivityRow(raw: unknown, fallbackDate: string): OpenRouterActivityRow {
  if (!raw || typeof raw !== "object") {
    return {
      date: fallbackDate,
      model: "unknown",
      costUsd: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
  }
  const record = raw as Record<string, unknown>;
  const promptTokens = asInt(record.prompt_tokens ?? record.input_tokens);
  const completionTokens = asInt(record.completion_tokens ?? record.output_tokens);
  return {
    date: asString(record.date) ?? fallbackDate,
    model: asString(record.model) ?? asString(record.endpoint) ?? "unknown",
    costUsd: Math.max(0, asNumber(record.usage ?? record.cost)),
    requests: asInt(record.requests),
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cachedTokens: asInt(record.cached_tokens ?? record.cache_hits),
  };
}

export interface OpenRouterAggregates {
  readonly today: OpenRouterWindowTotals;
  readonly last7Days: OpenRouterWindowTotals;
  readonly last30Days: OpenRouterWindowTotals;
  readonly models: OpenRouterModelTotals[];
}

/** Pure aggregation over normalized rows; tested without HTTP. */
export function aggregateOpenRouterActivity(
  rows: ReadonlyArray<OpenRouterActivityRow>,
  todayUtc: string,
): OpenRouterAggregates {
  const add = (
    into: OpenRouterWindowTotals,
    row: OpenRouterActivityRow,
  ): OpenRouterWindowTotals => ({
    costUsd: into.costUsd + row.costUsd,
    requests: into.requests + row.requests,
    inputTokens: into.inputTokens + row.inputTokens,
    outputTokens: into.outputTokens + row.outputTokens,
    cachedTokens: into.cachedTokens + row.cachedTokens,
  });
  let today = { ...EMPTY_WINDOW };
  let last7 = { ...EMPTY_WINDOW };
  let last30 = { ...EMPTY_WINDOW };
  const byModel = new Map<string, OpenRouterModelTotals>();
  for (const row of rows) {
    const ageDays = dayDiff(todayUtc, row.date);
    if (ageDays < 0 || ageDays > 29 || !Number.isInteger(ageDays)) continue;
    last30 = add(last30, row);
    if (ageDays <= 6) last7 = add(last7, row);
    if (ageDays === 0) today = add(today, row);
    const current = byModel.get(row.model) ?? {
      model: row.model,
      costUsd: 0,
      requests: 0,
      totalTokens: 0,
    };
    byModel.set(row.model, {
      model: row.model,
      costUsd: current.costUsd + row.costUsd,
      requests: current.requests + row.requests,
      totalTokens: current.totalTokens + row.inputTokens + row.outputTokens,
    });
  }
  const models = [...byModel.values()]
    .toSorted((left, right) => right.costUsd - left.costUsd)
    .slice(0, MAX_MODELS);
  return { today, last7Days: last7, last30Days: last30, models };
}

function dayDiff(todayUtc: string, date: string): number {
  const dayMs = 86_400_000;
  const today = Date.parse(`${todayUtc}T00:00:00Z`);
  const other = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(today) || !Number.isFinite(other)) return Number.NaN;
  return Math.round((today - other) / dayMs);
}

function fail(message: string, cause?: unknown): OpenRouterUsageError {
  return new OpenRouterUsageError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

let cached: { readonly atMs: number; readonly value: OpenRouterUsageResult } | null = null;

const readKey = Effect.fn("FourSpaces.readOpenRouterKey")(function* () {
  const secrets = yield* ServerSecretStore;
  const found = yield* secrets
    .get(SECRET_NAME)
    .pipe(Effect.mapError((cause) => fail("Could not read the stored OpenRouter key.", cause)));
  const bytes = Option.getOrNull(found);
  if (!bytes) return null;
  const key = new TextDecoder().decode(bytes).trim();
  return key.length > 0 ? key : null;
});

const fetchJson = Effect.fn("FourSpaces.fetchOpenRouterJson")(function* (
  httpClient: HttpClient.HttpClient,
  path: string,
  key: string,
) {
  const response = yield* httpClient
    .get(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } })
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.timeout(15_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
  if (!response) return null;
  return yield* response.json.pipe(Effect.catchCause(() => Effect.succeed(null)));
});

export const getOpenRouterUsage = Effect.fn("FourSpaces.getOpenRouterUsage")(
  function* (): Effect.fn.Return<
    OpenRouterUsageResult,
    OpenRouterUsageError,
    ServerSecretStore | HttpClient.HttpClient
  > {
    const nowMs = yield* Clock.currentTimeMillis;
    const nowIso = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
    if (cached && nowMs - cached.atMs < CACHE_TTL_MS) return cached.value;
    const key = yield* readKey();
    if (!key) {
      const value: OpenRouterUsageResult = {
        status: "unconfigured",
        today: { ...EMPTY_WINDOW },
        last7Days: { ...EMPTY_WINDOW },
        last30Days: { ...EMPTY_WINDOW },
        models: [],
        fetchedAt: nowIso,
      };
      cached = { atMs: nowMs, value };
      return value;
    }
    const httpClient = yield* HttpClient.HttpClient;
    const todayUtc = nowIso.slice(0, 10);
    const [keyInfo, credits, activity] = yield* Effect.all(
      [
        fetchJson(httpClient, "/auth/key", key),
        fetchJson(httpClient, "/credits", key),
        fetchJson(httpClient, "/activity", key),
      ],
      { concurrency: 3 },
    );
    if (!keyInfo && !credits && !activity) {
      // A stored key that OpenRouter rejects is data, not a transport failure:
      // the settings UI shows the message next to a Remove button.
      const value: OpenRouterUsageResult = {
        status: "error",
        today: { ...EMPTY_WINDOW },
        last7Days: { ...EMPTY_WINDOW },
        last30Days: { ...EMPTY_WINDOW },
        models: [],
        fetchedAt: nowIso,
        error: "OpenRouter did not answer. Check the key and try again.",
      };
      cached = { atMs: nowMs, value };
      return value;
    }
    const keyData =
      keyInfo && typeof keyInfo === "object" ? (keyInfo as Record<string, unknown>).data : null;
    const creditData =
      credits && typeof credits === "object" ? (credits as Record<string, unknown>).data : null;
    const activityRows =
      activity &&
      typeof activity === "object" &&
      Array.isArray((activity as Record<string, unknown>).data)
        ? ((activity as Record<string, unknown>).data as unknown[])
        : [];
    const aggregates = aggregateOpenRouterActivity(
      activityRows.map((row) => normalizeActivityRow(row, todayUtc)),
      todayUtc,
    );
    const keyRecord =
      keyData && typeof keyData === "object" ? (keyData as Record<string, unknown>) : null;
    const creditRecord =
      creditData && typeof creditData === "object" ? (creditData as Record<string, unknown>) : null;
    const value: OpenRouterUsageResult = {
      status: "configured",
      ...(asString(keyRecord?.label) ? { keyLabel: asString(keyRecord?.label) as string } : {}),
      ...(typeof creditRecord?.limit === "number"
        ? { creditLimit: creditRecord.limit as number }
        : {}),
      ...(typeof creditRecord?.usage === "number"
        ? { creditUsed: creditRecord.usage as number }
        : typeof creditRecord?.total_usage === "number"
          ? { creditUsed: creditRecord.total_usage as number }
          : {}),
      today: aggregates.today,
      last7Days: aggregates.last7Days,
      last30Days: aggregates.last30Days,
      models: aggregates.models,
      fetchedAt: nowIso,
    };
    cached = { atMs: nowMs, value };
    return value;
  },
);

export const setOpenRouterKey = Effect.fn("FourSpaces.setOpenRouterKey")(function* (key: string) {
  const secrets = yield* ServerSecretStore;
  yield* secrets
    .set(SECRET_NAME, new TextEncoder().encode(key.trim()))
    .pipe(Effect.mapError((cause) => fail("Could not store the OpenRouter key.", cause)));
  cached = null;
  return {};
});

export const clearOpenRouterKey = Effect.fn("FourSpaces.clearOpenRouterKey")(function* () {
  const secrets = yield* ServerSecretStore;
  const existing = yield* secrets
    .get(SECRET_NAME)
    .pipe(Effect.mapError((cause) => fail("Could not read the stored OpenRouter key.", cause)));
  if (Option.isNone(existing)) {
    cached = null;
    return {};
  }
  yield* secrets
    .remove(SECRET_NAME)
    .pipe(Effect.mapError((cause) => fail("Could not remove the OpenRouter key.", cause)));
  cached = null;
  return {};
});
