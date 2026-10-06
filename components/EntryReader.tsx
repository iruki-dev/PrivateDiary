"use client";

import { useEffect, useRef } from "react";
import { HighlightedText } from "./HighlightedText";
import { Icon } from "./Icon";
import { formatEntryTime } from "./EntryCard";
import type { MatchRange } from "@/lib/entries/search";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" });
const shortFormatter = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

export interface ReaderEntry {
  id: string;
  createdAt: Date | null;
  text: string;
  ranges: MatchRange[];
}

/**
 * One entry, in full, at reading size — the list (components/EntryCard)
 * only shows how each one begins.
 *
 * A view inside the diary rather than a route of its own, for the same
 * reason the list keeps its filters out of the URL (EntryBrowser): a
 * `/entries/<id>` in browser history would record exactly which entry
 * someone went back to read. Previous/next walk the list as it is
 * currently filtered and sorted.
 */
export function EntryReader({
  entry,
  previous,
  next,
  onSelect,
  onClose,
}: {
  entry: ReaderEntry;
  previous: ReaderEntry | null;
  next: ReaderEntry | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Opening an entry (or stepping to the next one) moves focus and the
  // viewport to its heading, so it reads as a new page.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [entry.id]);

  const date = entry.createdAt;

  return (
    <article aria-labelledby="entry-reader-title" className="-mx-5 min-h-[70vh] bg-surface px-5 pb-10 pt-2 sm:mx-0 sm:rounded-3xl sm:px-8 sm:pt-4">
      <button type="button" onClick={onClose} className="btn-text -ml-2 pl-0.5 text-ink">
        <Icon name="chevron-left" size={26} strokeWidth={2} />
        일기장
      </button>

      <header className="mt-3 space-y-1">
        {date && <p className="text-sm font-semibold text-ink-3">{date.getFullYear()}년</p>}
        <h2
          id="entry-reader-title"
          ref={headingRef}
          tabIndex={-1}
          className="title-1 focus:outline-none"
        >
          {date ? dateFormatter.format(date) : "저장하는 중"}
        </h2>
        <p className="text-sm text-ink-3 tabular-nums">
          {formatEntryTime(date)} · {entry.text.length.toLocaleString("ko-KR")}자
        </p>
      </header>

      <div className="mt-6 whitespace-pre-wrap text-[1.0625rem] leading-7">
        <HighlightedText text={entry.text} ranges={entry.ranges} />
      </div>

      <p className="mt-8 flex items-center gap-1.5 border-t border-line pt-4 text-[0.8125rem] font-medium text-ink-3">
        <Icon name="lock" size={15} strokeWidth={2} />
        나만 읽을 수 있는 일기예요
      </p>

      {(previous || next) && (
        <nav aria-label="다른 일기" className="mt-5 grid grid-cols-2 gap-2">
          {previous ? (
            <button
              type="button"
              onClick={() => onSelect(previous.id)}
              className="flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-2xl bg-fill px-4 py-3 text-left transition-colors hover:bg-pill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span className="text-[0.8125rem] text-ink-3">이전 일기</span>
              <span className="text-[0.9375rem] font-semibold">{label(previous)}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              type="button"
              onClick={() => onSelect(next.id)}
              className="flex min-h-16 flex-col items-end justify-center gap-0.5 rounded-2xl bg-fill px-4 py-3 text-right transition-colors hover:bg-pill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span className="text-[0.8125rem] text-ink-3">다음 일기</span>
              <span className="text-[0.9375rem] font-semibold">{label(next)}</span>
            </button>
          )}
        </nav>
      )}
    </article>
  );
}

function label(entry: ReaderEntry): string {
  return entry.createdAt
    ? `${shortFormatter.format(entry.createdAt)} ${formatEntryTime(entry.createdAt)}`
    : "저장하는 중";
}
