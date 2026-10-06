"use client";

import { HighlightedText } from "./HighlightedText";
import { Icon } from "./Icon";
import { buildSnippet, splitLead, type MatchRange } from "@/lib/entries/search";

/**
 * One diary entry in the list: a card that opens the entry in full
 * (components/EntryReader). The list shows only the beginning — a long
 * diary dumped in full is a wall nobody can scan — and the whole card is
 * the tap target, with a chevron saying so.
 *
 * The first entry of a day carries the date block (day number + weekday);
 * later entries the same day leave it blank, so a day reads as one group.
 *
 * While searching, the card shows the window around the first match
 * instead of the opening lines, so a hit buried deep in a long entry is
 * visible without opening anything.
 */

const timeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatEntryTime(date: Date | null): string {
  return date ? timeFormatter.format(date) : "저장하는 중";
}

export interface EntryCardProps {
  createdAt: Date | null;
  /** Decrypted body, or null while this entry is still being decrypted. */
  text: string | null;
  /** Per-entry decryption failure (ARCHITECTURE.md §3.4 — a failure IS the tamper signal). */
  error?: string;
  /** Match ranges into `text`; empty when no search is active. */
  ranges: MatchRange[];
  searching: boolean;
  /** First entry of its day: show the day number and weekday. */
  showDate: boolean;
  onOpen: () => void;
}

function DateBlock({ date, show }: { date: Date | null; show: boolean }) {
  return (
    <span aria-hidden className={`flex flex-col items-center gap-0.5 pt-0.5 ${show && date ? "" : "invisible"}`}>
      <span className="text-[1.375rem] leading-[1.625rem] font-extrabold tracking-[-0.02em] tabular-nums">
        {date?.getDate()}
      </span>
      <span className="text-xs font-semibold text-ink-3">{date ? WEEKDAYS[date.getDay()] : ""}</span>
    </span>
  );
}

export function EntryCard({ createdAt, text, error, ranges, searching, showDate, onOpen }: EntryCardProps) {
  const time = formatEntryTime(createdAt);
  const frame = "grid w-full grid-cols-[2.5rem_minmax(0,1fr)] gap-3 rounded-2xl bg-surface py-4 pl-3 pr-4 text-left";

  if (error) {
    return (
      <li className={frame}>
        <DateBlock date={createdAt} show={showDate} />
        <div className="space-y-1">
          <p className="text-[0.8125rem] font-medium text-ink-3 tabular-nums">{time}</p>
          <p role="alert" className="flex gap-2 text-[0.9375rem] leading-6 text-danger">
            <Icon name="alert" size={18} className="mt-[3px] shrink-0" />
            {error}
          </p>
        </div>
      </li>
    );
  }

  if (text === null) {
    return (
      <li className={frame} aria-busy="true">
        <DateBlock date={createdAt} show={showDate} />
        <div className="space-y-2.5 pt-1">
          <p className="text-[0.8125rem] font-medium text-ink-3 tabular-nums">{time}</p>
          <span className="block h-3.5 w-[92%] animate-pulse rounded-full bg-fill" />
          <span className="block h-3.5 w-[64%] animate-pulse rounded-full bg-fill" />
          <span className="sr-only">일기를 여는 중</span>
        </div>
      </li>
    );
  }

  const snippet = searching ? buildSnippet(text, ranges, 40) : null;
  const { lead, rest } = snippet ? { lead: null, rest: "" } : splitLead(text);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`${frame} group transition-shadow hover:shadow-[0_0_0_1px_var(--line),0_6px_18px_rgb(0_0_0/0.06)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`}
      >
        <DateBlock date={createdAt} show={showDate} />
        <span className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-[0.8125rem] font-medium text-ink-3 tabular-nums">{time}</span>
            {snippet ? (
              <span className="block text-[0.9375rem] leading-6 text-ink-2">
                {snippet.truncatedStart ? "…" : ""}
                <HighlightedText text={snippet.text} ranges={snippet.ranges} />
                {snippet.truncatedEnd ? "…" : ""}
              </span>
            ) : (
              <>
                {lead && <span className="block text-base leading-6 font-semibold">{lead}</span>}
                {rest && (
                  <span
                    className={`block whitespace-pre-line text-[0.9375rem] leading-6 text-ink-2 ${lead ? "line-clamp-2" : "line-clamp-3"}`}
                  >
                    {rest}
                  </span>
                )}
              </>
            )}
          </span>
          <Icon name="chevron-right" size={18} className="mt-6 shrink-0 text-ink-4 transition-colors group-hover:text-ink-3" />
        </span>
      </button>
    </li>
  );
}
