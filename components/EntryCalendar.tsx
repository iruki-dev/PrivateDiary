"use client";

import { buildMonthGrid, dayKey, shiftMonth } from "@/lib/entries/calendar";
import { Icon } from "@/components/Icon";

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

  const navButton =
    "flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-fill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink";
  const footButton =
    "flex min-h-10 items-center rounded-full px-3 text-[0.8125rem] font-semibold text-ink-2 transition-colors hover:bg-fill hover:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-ink";

  return (
    <div className="space-y-2 rounded-2xl bg-surface px-3 pb-3 pt-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => {
            const previous = shiftMonth(year, month, -1);
            onMonthChange(previous.year, previous.month);
          }}
          className={navButton}
        >
          <Icon name="chevron-left" size={20} strokeWidth={2} />
        </button>

        <h2 aria-live="polite" className="text-[1.0625rem] font-bold">
          {label}
        </h2>

        <button
          type="button"
          aria-label="다음 달"
          onClick={() => {
            const next = shiftMonth(year, month, 1);
            onMonthChange(next.year, next.month);
          }}
          className={navButton}
        >
          <Icon name="chevron-right" size={20} strokeWidth={2} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-semibold text-ink-3">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday}>{weekday}</div>
        ))}
      </div>

      {/* Filled: a day with entries. Ink: the selected day. Ring: today.
          Three different shapes of cue, so none of them rests on colour. */}
      <div className="grid grid-cols-7 justify-items-center gap-y-1">
        {weeks.flat().map((cell) => {
          const selected = cell.key === selectedDay;
          const hasEntries = cell.count > 0;
          const todayRing = cell.isToday && !selected ? "ring-2 ring-inset ring-ink" : "";

          if (!hasEntries) {
            return (
              <div
                key={cell.key}
                aria-hidden={!cell.inMonth}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[0.9375rem] tabular-nums ${
                  cell.inMonth ? "text-ink-3" : "text-transparent"
                } ${todayRing}`}
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
              aria-label={`${cell.date.getFullYear()}년 ${cell.date.getMonth() + 1}월 ${cell.day}일, 일기 ${cell.count}개${cell.isToday ? ", 오늘" : ""}`}
              // Clicking the selected day again clears the filter — the
              // same affordance as the chip above the list, so there is no
              // state you can get into without an obvious way back out.
              onClick={() => onSelectDay(selected ? null : cell.key)}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-[0.9375rem] font-bold tabular-nums transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                selected
                  ? "bg-primary text-on-primary"
                  : `${cell.inMonth ? "bg-pill text-ink" : "bg-fill text-ink-3"} hover:bg-off`
              } ${todayRing}`}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={goToToday} className={footButton}>
          이번 달
        </button>
        {selectedDay && (
          <button type="button" onClick={() => onSelectDay(null)} className={footButton}>
            날짜 선택 풀기
          </button>
        )}
        {!selectedDay && counts.has(todayKey) && (
          <button type="button" onClick={() => onSelectDay(todayKey)} className={footButton}>
            오늘 쓴 일기
          </button>
        )}
      </div>
    </div>
  );
}
