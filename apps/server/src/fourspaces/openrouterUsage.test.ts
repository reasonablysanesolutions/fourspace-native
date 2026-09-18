import { describe, expect, it } from "@effect/vitest";

import {
  aggregateOpenRouterActivity,
  normalizeActivityRow,
  type OpenRouterActivityRow,
} from "./openrouterUsage.ts";

const row = (overrides: Partial<OpenRouterActivityRow> = {}): OpenRouterActivityRow => ({
  date: "2026-09-18",
  model: "openai/gpt-5",
  costUsd: 1,
  requests: 2,
  inputTokens: 100,
  outputTokens: 50,
  cachedTokens: 10,
  ...overrides,
});

describe("aggregateOpenRouterActivity", () => {
  it("buckets rows into today, 7-day and 30-day windows", () => {
    const aggregates = aggregateOpenRouterActivity(
      [
        row({ date: "2026-09-18", costUsd: 1 }),
        row({ date: "2026-09-12", costUsd: 2, model: "anthropic/claude" }),
        row({ date: "2026-08-25", costUsd: 4, model: "x-ai/grok" }),
        row({ date: "2026-08-01", costUsd: 8, model: "old/model" }),
        row({ date: "2026-09-19", costUsd: 16, model: "future/model" }),
      ],
      "2026-09-18",
    );
    expect(aggregates.today.costUsd).toBe(1);
    expect(aggregates.last7Days.costUsd).toBe(3);
    expect(aggregates.last30Days.costUsd).toBe(7);
    expect(aggregates.models.map((model) => model.model)).toEqual([
      "x-ai/grok",
      "anthropic/claude",
      "openai/gpt-5",
    ]);
  });

  it("sums tokens and requests per window and model", () => {
    const aggregates = aggregateOpenRouterActivity([row(), row()], "2026-09-18");
    expect(aggregates.today.requests).toBe(4);
    expect(aggregates.today.inputTokens).toBe(200);
    expect(aggregates.today.outputTokens).toBe(100);
    expect(aggregates.today.cachedTokens).toBe(20);
    expect(aggregates.models[0]).toMatchObject({
      model: "openai/gpt-5",
      requests: 4,
      totalTokens: 300,
    });
  });

  it("normalizes unknown row shapes to zero rows instead of throwing", () => {
    expect(normalizeActivityRow(null, "2026-09-18").costUsd).toBe(0);
    expect(normalizeActivityRow("garbage", "2026-09-18").model).toBe("unknown");
    expect(
      normalizeActivityRow(
        { usage: "not-a-number", requests: -3, prompt_tokens: 10.9 },
        "2026-09-18",
      ),
    ).toMatchObject({ costUsd: 0, requests: 0, inputTokens: 10 });
    expect(
      normalizeActivityRow({ endpoint: "openai/gpt-5", cost: 0.5 }, "2026-09-18"),
    ).toMatchObject({ model: "openai/gpt-5", costUsd: 0.5 });
    const aggregates = aggregateOpenRouterActivity(
      [normalizeActivityRow({ date: "not-a-date", usage: 5 }, "2026-09-18")],
      "2026-09-18",
    );
    expect(aggregates.last30Days.costUsd).toBe(0);
  });
});
