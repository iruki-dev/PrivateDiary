import { describe, expect, it } from "vitest";
import {
  anniversaryKey,
  anniversaryYears,
  buildDayCounts,
  buildMonthGrid,
  computeStreak,
  dayKey,
  shiftMonth,
  summarizeDates,
} from "../calendar";

/** Local-time construction throughout, matching what the module documents. */
const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h);

describe("dayKey", () => {
  it("formats local date parts, zero-padded", () => {
    expect(dayKey(d(2026, 9, 4))).toBe("2026-09-04");
  });

  it("keeps a late-night entry on the day it felt like, not the UTC day", () => {
    // 23:30 local on the 14th stays the 14th regardless of the runner's
    // timezone — a UTC-based key would move it for anyone east of GMT.
    expect(dayKey(d(2026, 9, 14, 23))).toBe("2026-09-14");
    expect(dayKey(d(2026, 9, 14, 0))).toBe("2026-09-14");
  });
});

describe("anniversaryKey", () => {
  it("drops the year", () => {
    expect(anniversaryKey(d(2024, 9, 14))).toBe("09-14");
  });
});

describe("buildDayCounts", () => {
  it("counts entries per day and ignores unresolved timestamps", () => {
    const counts = buildDayCounts([d(2026, 9, 14), d(2026, 9, 14, 20), null, d(2026, 9, 15)]);
    expect(counts.get("2026-09-14")).toBe(2);
    expect(counts.get("2026-09-15")).toBe(1);
    expect(counts.size).toBe(2);
  });
});

describe("buildMonthGrid", () => {
  it("returns whole weeks starting on Sunday", () => {
    const weeks = buildMonthGrid(2026, 8, new Map(), d(2026, 9, 14));
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0].date.getDay()).toBe(0);
  });

  it("covers every day of the month exactly once", () => {
    const weeks = buildMonthGrid(2026, 8, new Map(), d(2026, 9, 14));
    const inMonth = weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(30); // September
    expect(new Set(inMonth.map((cell) => cell.key)).size).toBe(30);
  });

  it("pads with adjacent-month days marked inMonth: false", () => {
    // 2026-09-01 is a Tuesday, so two leading cells come from August.
    const weeks = buildMonthGrid(2026, 8, new Map(), d(2026, 9, 14));
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][2].key).toBe("2026-09-01");
  });

  it("uses only as many rows as the month needs", () => {
    const weeks = buildMonthGrid(2026, 8, new Map(), d(2026, 9, 14));
    expect(weeks.length).toBeLessThanOrEqual(6);
    expect(weeks.length).toBeGreaterThanOrEqual(4);
  });

  it("handles February in a leap year", () => {
    const inMonth = buildMonthGrid(2028, 1, new Map(), d(2028, 2, 1))
      .flat()
      .filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(29);
  });

  it("attaches counts and marks today", () => {
    const counts = new Map([["2026-09-14", 3]]);
    const cell = buildMonthGrid(2026, 8, counts, d(2026, 9, 14))
      .flat()
      .find((c) => c.key === "2026-09-14")!;
    expect(cell.count).toBe(3);
    expect(cell.isToday).toBe(true);
  });
});

describe("shiftMonth", () => {
  it("rolls over the year in both directions", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("computeStreak", () => {
  const today = d(2026, 9, 14);

  it("is zero for an empty diary", () => {
    expect(computeStreak([], today)).toEqual({ current: 0, longest: 0 });
  });

  it("counts consecutive days back from today", () => {
    const keys = ["2026-09-14", "2026-09-13", "2026-09-12"];
    expect(computeStreak(keys, today).current).toBe(3);
  });

  it("still counts the streak when today has not been written yet", () => {
    // The grace day: a month-long streak must not read as 0 every morning
    // until the person writes.
    const keys = ["2026-09-13", "2026-09-12"];
    expect(computeStreak(keys, today).current).toBe(2);
  });

  it("is broken once two days have passed with nothing written", () => {
    expect(computeStreak(["2026-09-12", "2026-09-11"], today).current).toBe(0);
  });

  it("finds the longest historical run even when the current one is short", () => {
    const keys = [
      "2026-09-14",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ];
    expect(computeStreak(keys, today)).toEqual({ current: 1, longest: 4 });
  });

  it("counts a run that crosses a month boundary", () => {
    const keys = ["2026-08-30", "2026-08-31", "2026-09-01"];
    expect(computeStreak(keys, d(2026, 9, 1)).current).toBe(3);
  });

  it("counts a run that crosses a year boundary", () => {
    const keys = ["2025-12-31", "2026-01-01"];
    expect(computeStreak(keys, d(2026, 1, 1)).current).toBe(2);
  });
});

describe("summarizeDates", () => {
  it("separates entry count from distinct days written", () => {
    const stats = summarizeDates(
      [d(2026, 9, 14), d(2026, 9, 14, 20), d(2026, 8, 1), null],
      d(2026, 9, 14)
    );
    expect(stats.total).toBe(4);
    expect(stats.daysWritten).toBe(2);
    expect(stats.thisMonth).toBe(2);
  });
});

describe("anniversaryYears", () => {
  it("finds earlier years with an entry on the same month and day, newest first", () => {
    const dates = [d(2026, 9, 14), d(2025, 9, 14), d(2023, 9, 14), d(2024, 9, 15)];
    expect(anniversaryYears(dates, d(2026, 9, 14))).toEqual([2025, 2023]);
  });

  it("excludes today's own entries", () => {
    expect(anniversaryYears([d(2026, 9, 14)], d(2026, 9, 14))).toEqual([]);
  });
});
