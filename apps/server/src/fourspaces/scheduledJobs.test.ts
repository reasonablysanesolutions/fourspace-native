import { describe, expect, it } from "@effect/vitest";
import type { ScheduledJobSchedule } from "@t3tools/contracts";

import { computeNextRunMs, validateSchedule } from "./scheduledJobs.ts";

const schedule = (overrides: Partial<ScheduledJobSchedule>): ScheduledJobSchedule => ({
  kind: "daily",
  ...overrides,
});

describe("validateSchedule", () => {
  it("accepts well-formed schedules and rejects the rest", () => {
    expect(validateSchedule(schedule({ kind: "once", atIso: "2026-09-19T07:00:00Z" }))).toBeNull();
    expect(validateSchedule(schedule({ kind: "once" }))).not.toBeNull();
    expect(validateSchedule(schedule({ kind: "daily", hour: 7, minute: 30 }))).toBeNull();
    expect(validateSchedule(schedule({ kind: "daily", hour: 25 }))).not.toBeNull();
    expect(validateSchedule(schedule({ kind: "weekly", weekday: 5, hour: 16 }))).toBeNull();
    expect(validateSchedule(schedule({ kind: "weekly", weekday: 7 }))).not.toBeNull();
    expect(validateSchedule(schedule({ kind: "interval", intervalMinutes: 60 }))).toBeNull();
    expect(validateSchedule(schedule({ kind: "interval", intervalMinutes: 1 }))).not.toBeNull();
    expect(
      validateSchedule(schedule({ kind: "daily", hour: 7, timeZone: "Mars/Olympus" })),
    ).not.toBeNull();
  });
});

describe("computeNextRunMs", () => {
  it("fires a one-off job once, at its instant", () => {
    const at = Date.parse("2026-09-19T07:00:00Z");
    expect(computeNextRunMs({ kind: "once", atIso: "2026-09-19T07:00:00Z" }, at - 1000)).toBe(at);
    expect(computeNextRunMs({ kind: "once", atIso: "2026-09-19T07:00:00Z" }, at)).toBeNull();
    expect(computeNextRunMs({ kind: "once", atIso: "2026-09-19T07:00:00Z" }, at + 1000)).toBeNull();
  });

  it("schedules daily jobs at the wall-clock time in zone", () => {
    // 2026-09-18 is a Friday. 07:00 in Stockholm (UTC+2) is 05:00Z.
    const friday = Date.parse("2026-09-18T04:00:00Z");
    expect(
      computeNextRunMs({ kind: "daily", hour: 7, minute: 0, timeZone: "Europe/Stockholm" }, friday),
    ).toBe(Date.parse("2026-09-18T05:00:00Z"));
    // After today's slot, tomorrow's.
    expect(
      computeNextRunMs(
        { kind: "daily", hour: 7, minute: 0, timeZone: "Europe/Stockholm" },
        Date.parse("2026-09-18T06:00:00Z"),
      ),
    ).toBe(Date.parse("2026-09-19T05:00:00Z"));
  });

  it("schedules weekly jobs on the right weekday", () => {
    // Friday 2026-09-18 → next Friday 16:00 Stockholm (14:00Z) is today.
    expect(
      computeNextRunMs(
        { kind: "weekly", weekday: 5, hour: 16, minute: 0, timeZone: "Europe/Stockholm" },
        Date.parse("2026-09-18T10:00:00Z"),
      ),
    ).toBe(Date.parse("2026-09-18T14:00:00Z"));
    // Monday 2026-09-21 → next Friday.
    expect(
      computeNextRunMs(
        { kind: "weekly", weekday: 5, hour: 16, minute: 0, timeZone: "Europe/Stockholm" },
        Date.parse("2026-09-21T10:00:00Z"),
      ),
    ).toBe(Date.parse("2026-09-25T14:00:00Z"));
  });

  it("spaces interval jobs from their anchor", () => {
    const anchor = Date.parse("2026-09-18T07:00:00Z");
    expect(computeNextRunMs({ kind: "interval", intervalMinutes: 60 }, anchor, anchor)).toBe(
      anchor + 3_600_000,
    );
    expect(
      computeNextRunMs({ kind: "interval", intervalMinutes: 60 }, anchor + 30 * 60_000, anchor),
    ).toBe(anchor + 3_600_000);
    // Far behind: the next slot after now, not a stale one.
    expect(
      computeNextRunMs({ kind: "interval", intervalMinutes: 60 }, anchor + 5 * 3_600_000, anchor),
    ).toBe(anchor + 6 * 3_600_000);
  });
});
