"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EntryCard } from "./EntryCard";
import { EntryCalendar } from "./EntryCalendar";
import { EntryStats } from "./EntryStats";
import { ExportEntriesCard } from "./ExportEntriesCard";
import { useDecryptedEntries } from "@/hooks/useDecryptedEntries";
import type { HybridPrivateKeys } from "@/lib/crypto";
import type { EntrySequenceIntegrity, StoredEntry } from "@/lib/firebase/entries";
import { groupByDay, matchEntry, parseQuery, type MatchRange } from "@/lib/entries/search";
import {
  anniversaryKey,
  anniversaryYears,
  buildDayCounts,
  dayKey,
  summarizeDates,
} from "@/lib/entries/calendar";
import type { ExportableEntry } from "@/lib/entries/export";

/**
 * The unlocked reading view: calendar, search, filters, month grouping,
 * incremental decryption, export.
 *
 * All of it is necessarily client-side. The server holds nothing but
 * ciphertext (ARCHITECTURE.md §1.1), so it cannot filter, sort by content,
 * paginate by relevance, or answer a query — §9 lists that as a permanent
 * consequence of the design. Everything here works on plaintext that
 * exists only in this tab's memory, for as long as the session stays
 * unlocked.
 *
 * Two deliberate non-features, both for the same reason:
 *
 *  - No filter state in the URL. A query string like `?day=2026-09-14`
 *    would be written into browser history and into whatever syncs it,
 *    leaving a trail of exactly which days someone went back and reread —
 *    on the shared machine this app is otherwise careful about (§3.9,
 *    §3.12). Filters live in React state and die with the tab.
 *  - Nothing persisted to storage. No last-viewed month, no recent
 *    searches. A search box that remembers "장례식" is a worse leak than
 *    anything the encryption protects against.
 *
 * The calendar and statistics are built from `createdAt` alone, which
 * Firestore already stores in the clear and the list has always displayed
 * — see lib/entries/calendar.ts. They add no exposure, and they work
 * before a single entry has been decrypted.
 */

/** Which subset of entries the list is showing, beyond the text search. */
type DateFilter =
  | { kind: "all" }
  /** One specific calendar day, picked from the calendar. */
  | { kind: "day"; key: string }
  /** This month/day across every earlier year — "이날의 기록". */
  | { kind: "anniversary"; key: string };

type SortOrder = "newest" | "oldest";

interface PreparedEntry {
  id: string;
  entrySeq: number;
  createdAt: Date | null;
  text: string | null;
  error?: string;
  ranges: MatchRange[];
}

function toDate(entry: StoredEntry): Date | null {
  return entry.createdAt?.toDate?.() ?? null;
}

function formatDayLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

export function EntryBrowser({
  entries,
  integrity,
  privateKeys,
}: {
  entries: StoredEntry[];
  integrity: EntrySequenceIntegrity | null;
  privateKeys: HybridPrivateKeys;
}) {
  // Pinned at mount so "today", the streak and the anniversary row can't
  // shift under the user mid-session, and so every render agrees on them.
  const [today] = useState(() => new Date());

  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>({ kind: "all" });
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [exportOpen, setExportOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const searchRef = useRef<HTMLInputElement>(null);

  // Typing in a search box over a few hundred decrypted entries re-filters
  // on every keystroke; deferring keeps the input itself responsive and
  // lets React drop intermediate filter passes the user already typed past.
  const deferredQuery = useDeferredValue(query);

  const { plaintexts, errors, decryptedCount, total, done } = useDecryptedEntries(
    privateKeys,
    entries
  );

  const dates = useMemo(() => entries.map(toDate), [entries]);
  const dayCounts = useMemo(() => buildDayCounts(dates), [dates]);
  const stats = useMemo(() => summarizeDates(dates, today), [dates, today]);
  const anniversaries = useMemo(() => anniversaryYears(dates, today), [dates, today]);

  const terms = useMemo(() => parseQuery(deferredQuery), [deferredQuery]);
  const searching = terms.length > 0;
  const filtering = searching || dateFilter.kind !== "all";

  const prepared = useMemo<PreparedEntry[]>(() => {
    const result: PreparedEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      const createdAt = dates[index];

      // Date filters run first: they need no plaintext, so they stay exact
      // even while decryption is still in flight.
      if (dateFilter.kind === "day" && (!createdAt || dayKey(createdAt) !== dateFilter.key)) {
        continue;
      }
      if (
        dateFilter.kind === "anniversary" &&
        (!createdAt ||
          anniversaryKey(createdAt) !== dateFilter.key ||
          createdAt.getFullYear() >= today.getFullYear())
      ) {
        continue;
      }

      const text = plaintexts[entry.id] ?? null;
      const error = errors[entry.id];

      if (searching) {
        // An entry that hasn't been decrypted yet has no text to search,
        // and one that failed to decrypt never will — neither can match, so
        // neither belongs in a result list. The counter below tells the
        // user when the search is still working from a partial corpus.
        if (text === null) continue;
        const ranges = matchEntry(text, terms);
        if (ranges === null) continue;
        result.push({ id: entry.id, entrySeq: entry.entrySeq, createdAt, text, ranges });
      } else {
        result.push({ id: entry.id, entrySeq: entry.entrySeq, createdAt, text, error, ranges: [] });
      }
    }
    // `entries` arrives newest-first (entrySeq desc), so oldest-first is
    // just a reversal — done before grouping so the month headers come out
    // in the matching order too.
    return sortOrder === "oldest" ? result.reverse() : result;
  }, [entries, dates, plaintexts, errors, searching, terms, dateFilter, sortOrder, today]);

  const groups = useMemo(() => groupByDay(prepared, today.getFullYear()), [prepared, today]);

  const exportable = useMemo<ExportableEntry[]>(
    () =>
      entries
        .map((entry, index) => ({ entry, createdAt: dates[index] }))
        .filter(({ entry }) => plaintexts[entry.id] !== undefined)
        .map(({ entry, createdAt }) => ({
          id: entry.id,
          entrySeq: entry.entrySeq,
          createdAt,
          text: plaintexts[entry.id],
        })),
    [entries, dates, plaintexts]
  );

  const failedCount = Object.keys(errors).length;

  function selectDay(key: string | null) {
    setDateFilter(key ? { kind: "day", key } : { kind: "all" });
    setCalendarOpen(false);
  }

  function clearFilters() {
    setQuery("");
    setDateFilter({ kind: "all" });
  }

  // "/" to search and Escape to clear — the two shortcuts a reading list
  // earns. Both are checked against the focused element so they never
  // swallow a keystroke meant for an input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        setQuery("");
        setDateFilter({ kind: "all" });
        if (typing) target?.blur();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const calendar = (
    <EntryCalendar
      year={visibleMonth.year}
      month={visibleMonth.month}
      counts={dayCounts}
      today={today}
      selectedDay={dateFilter.kind === "day" ? dateFilter.key : null}
      onSelectDay={selectDay}
      onMonthChange={(year, month) => setVisibleMonth({ year, month })}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* Desktop: calendar and stats stay in view while the list scrolls. */}
      <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block">
        {calendar}
        <EntryStats stats={stats} />
      </aside>

      <div className="min-w-0 space-y-5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              className="faint pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="일기 검색"
              aria-label="일기 검색"
              className="field pl-9"
            />
          </div>
          {/* Phones/tablets: the same calendar the sidebar shows on wide
              screens — a permanently-open month grid would push the diary
              itself below the fold. */}
          <button
            type="button"
            onClick={() => setCalendarOpen((open) => !open)}
            aria-expanded={calendarOpen}
            className={`btn-secondary min-h-11 lg:hidden ${calendarOpen ? "bg-zinc-100 dark:bg-zinc-900" : ""}`}
          >
            달력
          </button>
        </div>

        {calendarOpen && (
          <div className="space-y-4 lg:hidden">
            {calendar}
            <EntryStats stats={stats} />
          </div>
        )}

        {/* "이날의 기록" — the reason to keep a diary for years. Offered
            only when there is actually something to look back at. */}
        {anniversaries.length > 0 && dateFilter.kind !== "anniversary" && (
          <button
            type="button"
            onClick={() => setDateFilter({ kind: "anniversary", key: anniversaryKey(today) })}
            className="card w-full text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <span className="text-sm font-medium">이날의 기록</span>
            <span className="muted mt-1 block text-xs">
              {anniversaries.map((year) => `${today.getFullYear() - year}년 전`).join(", ")} 오늘에도
              일기를 썼습니다.
            </span>
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-h-9 flex-wrap items-center gap-2">
            {dateFilter.kind === "day" && (
              <button
                type="button"
                onClick={() => setDateFilter({ kind: "all" })}
                className="btn-secondary btn-sm"
                aria-label={`${formatDayLabel(dateFilter.key)} 선택 해제`}
              >
                {formatDayLabel(dateFilter.key)}
                <span aria-hidden>✕</span>
              </button>
            )}
            {dateFilter.kind === "anniversary" && (
              <button
                type="button"
                onClick={() => setDateFilter({ kind: "all" })}
                className="btn-secondary btn-sm"
                aria-label="이날의 기록 선택 해제"
              >
                이날의 기록
                <span aria-hidden>✕</span>
              </button>
            )}
            <p className="muted text-xs" aria-live="polite">
              {filtering ? `${prepared.length}편 / 전체 ${total}편` : `${total}편`}
              {!done && ` · 여는 중 ${decryptedCount}/${total}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSortOrder((order) => (order === "newest" ? "oldest" : "newest"))}
            className="btn-sm inline-flex items-center gap-1 rounded text-zinc-600 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 dark:text-zinc-400"
            aria-label={`정렬: ${sortOrder === "newest" ? "최신순" : "오래된순"} (눌러서 바꾸기)`}
          >
            {sortOrder === "newest" ? "최신순" : "오래된순"}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4" />
            </svg>
          </button>
        </div>

        {searching && !done && (
          <p className="muted text-xs">아직 여는 중인 일기는 검색되지 않습니다. 모두 열리면 결과가 더 나올 수 있습니다.</p>
        )}

        {integrity && !integrity.ok && (
          <div role="alert" className="card space-y-1 border-amber-500/50">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              일기 목록이 온전하지 않습니다
            </p>
            {integrity.missingTailCount > 0 && (
              <p className="muted text-xs">
                저장된 기록보다 {integrity.missingTailCount}편이 적게 불러와졌습니다.
              </p>
            )}
            {integrity.missingSeqs.length > 0 && (
              <p className="muted text-xs">빠진 순번: {integrity.missingSeqs.join(", ")}</p>
            )}
            {integrity.duplicateSeqs.length > 0 && (
              <p className="muted text-xs">중복된 순번: {integrity.duplicateSeqs.join(", ")}</p>
            )}
            <p className="muted text-xs">
              불러온 일기의 내용은 모두 변조 검증을 통과했습니다. 서버에서 일기가 빠졌거나 중복되었을 수
              있습니다.
            </p>
          </div>
        )}

        {done && failedCount > 0 && (
          <p role="alert" className="error-text text-xs">
            {failedCount}편을 열지 못했습니다. 해당 일기에 표시됩니다.
          </p>
        )}

        {filtering && prepared.length === 0 && (
          <div className="card space-y-3 py-8 text-center">
            <p className="muted">
              {done ? "찾는 일기가 없습니다." : "아직 결과가 없습니다. 모두 열리면 더 나올 수 있습니다."}
            </p>
            <button type="button" onClick={clearFilters} className="btn-secondary btn-sm">
              검색 지우기
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`day-${group.key}`} className="space-y-2">
            <h2
              id={`day-${group.key}`}
              className="sticky top-14 z-10 -mx-1 bg-background/90 px-1 py-1.5 text-sm font-semibold backdrop-blur"
            >
              {group.label}
            </h2>
            <ul className="divide-y divide-zinc-200 rounded border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
              {group.entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  createdAt={entry.createdAt}
                  text={entry.text}
                  error={entry.error}
                  ranges={entry.ranges}
                  searching={searching}
                />
              ))}
            </ul>
          </section>
        ))}

        {/* Export is occasional, so it sits after the diary rather than in
            the toolbar above it. */}
        <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          {exportOpen ? (
            <ExportEntriesCard
              entries={exportable}
              disabled={!done}
              disabledReason="아직 일기를 여는 중입니다. 모두 열린 뒤에 내보내면 빠진 일기 없이 저장됩니다."
              onClose={() => setExportOpen(false)}
            />
          ) : (
            <button type="button" onClick={() => setExportOpen(true)} className="btn-secondary btn-sm">
              모든 일기 내보내기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
