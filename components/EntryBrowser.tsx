"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EntryCard } from "./EntryCard";
import { EntryCalendar } from "./EntryCalendar";
import { EntryStats } from "./EntryStats";
import { ExportEntriesCard } from "./ExportEntriesCard";
import { useDecryptedEntries } from "@/hooks/useDecryptedEntries";
import type { HybridPrivateKeys } from "@/lib/crypto";
import type { EntrySequenceIntegrity, StoredEntry } from "@/lib/firebase/entries";
import { groupByMonth, matchEntry, parseQuery, type MatchRange } from "@/lib/entries/search";
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

  const groups = useMemo(() => groupByMonth(prepared), [prepared]);

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
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="일기 검색"
            aria-label="일기 검색"
            className="field min-w-0 flex-1 sm:min-w-56"
          />
          {/* Mobile/tablet entry point to the same calendar the sidebar
              shows on wide screens — a permanently-open month grid would
              push the actual diary below the fold on a phone. */}
          <button
            type="button"
            onClick={() => setCalendarOpen((open) => !open)}
            aria-expanded={calendarOpen}
            className="btn-secondary btn-sm lg:hidden"
          >
            달력
          </button>
          <button
            type="button"
            onClick={() => setExportOpen((open) => !open)}
            aria-expanded={exportOpen}
            className="btn-secondary btn-sm"
          >
            내보내기
          </button>
        </div>

        {calendarOpen && (
          <div className="space-y-4 lg:hidden">
            {calendar}
            <EntryStats stats={stats} />
          </div>
        )}

        {exportOpen && (
          <ExportEntriesCard
            entries={exportable}
            disabled={!done}
            disabledReason="아직 복호화 중입니다. 전부 끝난 뒤에 내보내면 빠진 일기 없이 저장됩니다."
            onClose={() => setExportOpen(false)}
          />
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
              {anniversaries.map((year) => `${today.getFullYear() - year}년 전`).join(", ")} 오늘도
              일기를 썼습니다. 눌러서 확인하세요.
            </span>
          </button>
        )}

        {filtering && (
          <div className="flex flex-wrap items-center gap-2">
            {dateFilter.kind === "day" && (
              <button
                type="button"
                onClick={() => setDateFilter({ kind: "all" })}
                className="btn-secondary btn-sm"
                aria-label={`${formatDayLabel(dateFilter.key)} 필터 해제`}
              >
                {formatDayLabel(dateFilter.key)} ✕
              </button>
            )}
            {dateFilter.kind === "anniversary" && (
              <button
                type="button"
                onClick={() => setDateFilter({ kind: "all" })}
                className="btn-secondary btn-sm"
                aria-label="이날의 기록 필터 해제"
              >
                이날의 기록 ✕
              </button>
            )}
            <button type="button" onClick={clearFilters} className="text-xs link">
              모두 지우기
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="muted text-xs" aria-live="polite">
            {filtering ? `${prepared.length}개 표시 중 (전체 ${total}개)` : `총 ${total}개의 일기`}
          </p>
          <div className="flex items-center gap-3">
            {!done && (
              <span className="muted text-xs" aria-live="polite">
                복호화 {decryptedCount} / {total}
              </span>
            )}
            <button
              type="button"
              onClick={() => setSortOrder((order) => (order === "newest" ? "oldest" : "newest"))}
              className="text-xs link"
            >
              {sortOrder === "newest" ? "최신순" : "오래된순"}
            </button>
          </div>
        </div>

        {searching && !done && (
          <p className="muted text-xs">
            아직 복호화되지 않은 일기는 검색되지 않습니다 — 끝나면 결과가 더 나올 수 있습니다.
          </p>
        )}

        {integrity && !integrity.ok && (
          <div role="alert" className="card space-y-1 border-amber-500/50">
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              일기 목록이 온전하지 않습니다
            </p>
            {integrity.missingTailCount > 0 && (
              <p className="muted text-xs">
                저장된 기록보다 {integrity.missingTailCount}개의 일기가 적게 조회되었습니다.
              </p>
            )}
            {integrity.missingSeqs.length > 0 && (
              <p className="muted text-xs">누락된 순번: {integrity.missingSeqs.join(", ")}</p>
            )}
            {integrity.duplicateSeqs.length > 0 && (
              <p className="muted text-xs">중복된 순번: {integrity.duplicateSeqs.join(", ")}</p>
            )}
            <p className="muted text-xs">
              각 일기의 내용 자체는 여전히 변조 검증을 통과했습니다. 목록에서 일기가 빠졌거나 중복된
              것으로, 서버 측 삭제·누락일 수 있습니다.
            </p>
          </div>
        )}

        {done && failedCount > 0 && (
          <p role="alert" className="error-text text-xs">
            {failedCount}개의 일기를 복호화하지 못했습니다. 아래 목록에 개별적으로 표시됩니다.
          </p>
        )}

        {filtering && prepared.length === 0 && (
          <div className="card space-y-3 py-6 text-center">
            <p className="muted text-sm">
              {done
                ? "조건에 맞는 일기가 없습니다."
                : "아직 결과가 없습니다 — 복호화가 끝나면 더 나올 수 있습니다."}
            </p>
            <button type="button" onClick={clearFilters} className="text-xs link">
              필터 지우기
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} className="space-y-3">
            <h2 className="sticky top-14 z-10 -mx-1 bg-background/90 px-1 py-1 text-xs font-medium text-zinc-500 backdrop-blur dark:text-zinc-400">
              {group.label}
            </h2>
            <ul className="space-y-4">
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
      </div>
    </div>
  );
}
