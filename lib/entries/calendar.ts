/**
 * Calendar, streak and anniversary logic for the entry list.
 *
 * SECURITY NOTE, because a calendar looks like it might be one: everything
 * in this module is derived from `entries.createdAt` alone — never from
 * plaintext. Those timestamps are already stored server-side in the clear
 * (ARCHITECTURE.md §4) and the entry list has always displayed them, so
 * visualising them adds no information that Firestore, or anyone reading
 * it, did not already have. The server learns WHEN you wrote; it still
 * never learns WHAT. That metadata exposure is a pre-existing, accepted
 * property of the design, not something introduced here.
 *
 * The corollary is that all of this works while entries are still
 * decrypting — the calendar, the counts and the streak are correct from
 * the first paint, before a single ciphertext has been opened.
 *
 * Pure: no crypto, Firebase, DOM or React imports. All dates are handled
 * in LOCAL time, deliberately — a diary day is the day it felt like to the
 * person writing, not a UTC boundary that would put a 23:30 entry on
 * tomorrow's square.
 */

/** Local-time "YYYY-MM-DD". The canonical key for a diary day. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "MM-DD" — the key for "this day in any year" (anniversary lookups). */
export function anniversaryKey(date: Date): string {
  return dayKey(date).slice(5);
}

/** How many entries fall on each day. Entries with no resolved timestamp are skipped. */
export function buildDayCounts(dates: readonly (Date | null)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    if (!date) continue;
    const key = dayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface DayCell {
  key: string;
  date: Date;
  day: number;
  /** False for the leading/trailing days borrowed from the adjacent months. */
  inMonth: boolean;
  count: number;
  isToday: boolean;
}

/** Sunday-first, matching the 일–토 header the UI renders. */
const WEEK_START = 0;

/**
 * Whole weeks covering `year`/`month` (0-indexed), padded with the
 * adjacent months' days so every row has 7 cells. Returns 4–6 rows — only
 * as many as the month actually needs, rather than always 6, so short
 * months don't leave a blank row on a phone.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  counts: ReadonlyMap<string, number>,
  today: Date
): DayCell[][] {
  const first = new Date(year, month, 1);
  const leading = (first.getDay() - WEEK_START + 7) % 7;
  const start = new Date(year, month, 1 - leading);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const todayKey = dayKey(today);

  const weeks: DayCell[][] = [];
  for (let index = 0; index < totalCells; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKey(date);
    const cell: DayCell = {
      key,
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      count: counts.get(key) ?? 0,
      isToday: key === todayKey,
    };
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }
  return weeks;
}

/** Moves `delta` months from year/month, rolling the year over correctly. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = new Date(year, month + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

export interface Streak {
  /** Days written in a row, counting back from today. */
  current: number;
  /** The longest such run anywhere in the diary's history. */
  longest: number;
}

function previousDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return dayKey(new Date(year, month - 1, day - 1));
}

/**
 * Writing streaks — the one piece of gamification a diary earns, since the
 * hard part of keeping one is showing up.
 *
 * `current` counts back from today, but starts at YESTERDAY when nothing
 * has been written today yet. Without that grace a streak someone has kept
 * for a month would read as 0 every morning until they wrote, which is
 * both wrong and exactly the moment the number is supposed to encourage
 * them.
 */
export function computeStreak(dayKeys: Iterable<string>, today: Date): Streak {
  const days = new Set(dayKeys);
  if (days.size === 0) return { current: 0, longest: 0 };

  const todayKey = dayKey(today);
  const yesterdayKey = previousDayKey(todayKey);

  let current = 0;
  let cursor = days.has(todayKey) ? todayKey : days.has(yesterdayKey) ? yesterdayKey : null;
  while (cursor && days.has(cursor)) {
    current += 1;
    cursor = previousDayKey(cursor);
  }

  // Sorting lexically is sorting chronologically for zero-padded ISO days.
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    run = previous !== null && previousDayKey(key) === previous ? run + 1 : 1;
    previous = key;
    if (run > longest) longest = run;
  }

  return { current, longest };
}

export interface EntryDateStats {
  total: number;
  thisMonth: number;
  /** Distinct days written on, not entries — two entries in one day is one day. */
  daysWritten: number;
  streak: Streak;
}

export function summarizeDates(dates: readonly (Date | null)[], today: Date): EntryDateStats {
  const counts = buildDayCounts(dates);
  const thisMonthPrefix = dayKey(today).slice(0, 7);
  let thisMonth = 0;
  for (const [key, count] of counts) {
    if (key.startsWith(thisMonthPrefix)) thisMonth += count;
  }
  return {
    total: dates.length,
    thisMonth,
    daysWritten: counts.size,
    streak: computeStreak(counts.keys(), today),
  };
}

/**
 * Which entry dates fall on the same month/day as `today` in an EARLIER
 * year — the "이날의 기록" that makes a long-running diary worth keeping.
 * Today's own entries are excluded; the point is what you wrote then, not
 * what you are writing now.
 */
export function anniversaryYears(dates: readonly (Date | null)[], today: Date): number[] {
  const target = anniversaryKey(today);
  const years = new Set<number>();
  for (const date of dates) {
    if (!date) continue;
    if (anniversaryKey(date) === target && date.getFullYear() < today.getFullYear()) {
      years.add(date.getFullYear());
    }
  }
  return [...years].sort((a, b) => b - a);
}
