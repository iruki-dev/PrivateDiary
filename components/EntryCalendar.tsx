"use client";

import { buildMonthGrid, dayKey, shiftMonth } from "@/lib/entries/calendar";

/**
 * Month grid showing which days have entries.
 *
 * Built entirely from `createdAt` (see lib/entries/calendar.ts's note on
 * why that exposes nothing new), so it is fully populated and usable while
 * the entries themselves are still decrypting.
 *
 * Days with nothing written are rendered as plain text rather than
 * disabled buttons: a keyboard user tabbing through a month should land on
 * the handful of days that actually go somewhere, not on thirty inert
 * stops.
 */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

export function EntryCalendar({
  year,
  month,
  counts,
  today,
  selectedDay,
  onSelectDay,
  onMonthChange,
}: {
  year: number;
  /** 0-indexed, like Date. */
  month: number;
  counts: ReadonlyMap<string, number>;
  today: Date;
  selectedDay: string | null;
  onSelectDay: (key: string | null) => void;
  onMonthChange: (year: number, month: number) => void;
}) {
  const weeks = buildMonthGrid(year, month, counts, today);
  const todayKey = dayKey(today);
  const label = `${year}년 ${month + 1}월`;

  function goToToday() {
    onMonthChange(today.getFullYear(), today.getMonth());
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => {
            const previous = shiftMonth(year, month, -1);
            onMonthChange(previous.year, previous.month);
          }}
          className="flex h-9 w-9 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 dark:hover:bg-zinc-800"
        >
          <ChevronIcon direction="left" />
        </button>

        <h2 aria-live="polite" className="text-sm font-medium">
          {label}
        </h2>

        <button
          type="button"
          aria-label="다음 달"
          onClick={() => {
            const next = shiftMonth(year, month, 1);
            onMonthChange(next.year, next.month);
          }}
          className="flex h-9 w-9 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 dark:hover:bg-zinc-800"
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] text-zinc-400">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday}>{weekday}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((cell) => {
          const selected = cell.key === selectedDay;
          const hasEntries = cell.count > 0;

          if (!hasEntries) {
            return (
              <div
                key={cell.key}
                aria-hidden={!cell.inMonth}
                className={`flex aspect-square items-center justify-center rounded text-xs ${
                  cell.inMonth ? "text-zinc-400 dark:text-zinc-600" : "text-transparent"
                } ${cell.isToday ? "ring-1 ring-zinc-300 dark:ring-zinc-700" : ""}`}
              >
                {cell.day}
              </div>
            );
          }

          return (
            <button
              key={cell.key}
              type="button"
              aria-pressed={selected}
              aria-label={`${cell.date.getFullYear()}년 ${cell.date.getMonth() + 1}월 ${cell.day}일, 일기 ${cell.count}개${cell.isToday ? " (오늘)" : ""}`}
              // Clicking the selected day again clears the filter — the
              // same affordance as the chip above the list, so there is no
              // state you can get into without an obvious way back out.
              onClick={() => onSelectDay(selected ? null : cell.key)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 ${
                selected
                  ? "bg-foreground font-medium text-background"
                  : `font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      cell.inMonth ? "" : "text-zinc-400 dark:text-zinc-500"
                    }`
              } ${cell.isToday && !selected ? "ring-1 ring-zinc-400 dark:ring-zinc-500" : ""}`}
            >
              {cell.day}
              <span
                aria-hidden
                className={`absolute bottom-1 h-1 w-1 rounded-full ${
                  selected ? "bg-background" : "bg-zinc-400 dark:bg-zinc-500"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" onClick={goToToday} className="text-xs link">
          오늘
        </button>
        {selectedDay && (
          <button type="button" onClick={() => onSelectDay(null)} className="text-xs link">
            날짜 선택 해제
          </button>
        )}
        {!selectedDay && counts.has(todayKey) && (
          <button type="button" onClick={() => onSelectDay(todayKey)} className="text-xs link">
            오늘 쓴 일기 보기
          </button>
        )}
      </div>
    </div>
  );
}
