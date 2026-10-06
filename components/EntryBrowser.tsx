"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EntryCard } from "./EntryCard";
import { EntryReader, type ReaderEntry } from "./EntryReader";
import { Icon } from "./Icon";
import { EntryCalendar } from "./EntryCalendar";
import { EntryStats } from "./EntryStats";
import { ExportEntriesCard } from "./ExportEntriesCard";
import { useDecryptedEntries } from "@/hooks/useDecryptedEntries";
import type { HybridPrivateKeys } from "@/lib/crypto";
import type { EntrySequenceIntegrity, StoredEntry } from "@/lib/firebase/entries";
import { matchEntry, parseQuery, splitLead, type MatchRange } from "@/lib/entries/search";
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
  // The entry open in the reading view (components/EntryReader), if any.
  const [readerId, setReaderId] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const searchRef = useRef<HTMLInputElement>(null);

  // Typing in a search box over a few hundred decrypted entries re-filters
  // on every keystroke; deferring keeps the input itself responsive and
  // lets React drop intermediate filter passes the user already typed past.
  const deferredQuery = useDeferredValue(query);

  const { plaintexts, errors, total, done } = useDecryptedEntries(
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

  // The list as rendered: a month heading whenever the month changes, then
  // one card per entry, with the date block on the first card of each day.
  const rows = useMemo(() => {
    type MonthRow = { kind: "month"; key: string; label: string; days: number; count: number };
    type EntryRow = { kind: "entry"; entry: PreparedEntry; showDate: boolean };
    const result: (MonthRow | EntryRow)[] = [];
    let month: MonthRow | null = null;
    let lastDay = "";
    const daysSeen = new Set<string>();
    for (const entry of prepared) {
      const date = entry.createdAt;
      const monthKey = date ? `${date.getFullYear()}-${date.getMonth()}` : "pending";
      if (!month || month.key !== monthKey) {
        month = {
          kind: "month",
          key: monthKey,
          label: date
            ? `${date.getFullYear() === today.getFullYear() ? "" : `${date.getFullYear()}년 `}${date.getMonth() + 1}월`
            : "저장하는 중",
          days: 0,
          count: 0,
        };
        result.push(month);
      }
      const day = date ? dayKey(date) : "pending";
      if (!daysSeen.has(day)) {
        daysSeen.add(day);
        month.days += 1;
      }
      month.count += 1;
      result.push({ kind: "entry", entry, showDate: day !== lastDay });
      lastDay = day;
    }
    return result;
  }, [prepared, today]);

  // Reading view: the open entry and its chronological neighbours in the
  // list as currently filtered (the list itself may be newest- or oldest-first).
  const reader = useMemo(() => {
    if (!readerId) return null;
    const index = prepared.findIndex((entry) => entry.id === readerId);
    const toReader = (entry: PreparedEntry | undefined): ReaderEntry | null =>
      entry && entry.text !== null
        ? { id: entry.id, createdAt: entry.createdAt, text: entry.text, ranges: entry.ranges }
        : null;
    const current = toReader(prepared[index]);
    if (!current) return null;
    const older = toReader(prepared[sortOrder === "newest" ? index + 1 : index - 1]);
    const newer = toReader(prepared[sortOrder === "newest" ? index - 1 : index + 1]);
    return { entry: current, previous: older, next: newer };
  }, [readerId, prepared, sortOrder]);

  // "1년 전 오늘": quote the most recent earlier-year entry from this day,
  // once it has been opened; until then the card just says it exists.
  let anniversaryQuote: { year: number; lead: string } | null = null;
  if (anniversaries.length > 0) {
    const target = anniversaryKey(today);
    for (const [index, entry] of entries.entries()) {
      const date = dates[index];
      const text = plaintexts[entry.id];
      if (!date || !text || anniversaryKey(date) !== target || date.getFullYear() >= today.getFullYear()) continue;
      anniversaryQuote = { year: date.getFullYear(), lead: splitLead(text).lead ?? `${text.slice(0, 60)}…` };
      break;
    }
  }

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

  // Read by the keydown listener below, which is registered once.
  const readerOpenRef = useRef(false);
  useEffect(() => {
    readerOpenRef.current = readerId !== null;
  }, [readerId]);

  // "/" to search, Escape to close the open entry or clear the filters — the two shortcuts a reading list
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
        if (readerOpenRef.current) {
          setReaderId(null);
          return;
        }
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

  if (reader) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <EntryReader
          entry={reader.entry}
          previous={reader.previous}
          next={reader.next}
          onSelect={setReaderId}
          onClose={() => setReaderId(null)}
        />
      </div>
    );
  }

  const chipClass =
    "inline-flex min-h-9 items-center gap-1 rounded-full bg-primary pl-3.5 pr-2 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-3.5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="일기 검색"
              aria-label="일기 검색"
              className="block h-11 w-full rounded-full border-0 bg-surface pl-11 pr-4 text-[1.0625rem] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-ink"
            />
          </div>
          {filtering ? (
            <button type="button" onClick={clearFilters} className="btn-text shrink-0 text-ink">
              닫기
            </button>
          ) : (
            // Phones/tablets: the same calendar the side column shows on wide
            // screens — a permanently-open month grid would push the diary
            // itself below the fold.
            <button
              type="button"
              onClick={() => setCalendarOpen((open) => !open)}
              aria-expanded={calendarOpen}
              aria-label="달력"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-ink lg:hidden ${
                calendarOpen ? "bg-primary text-on-primary" : "bg-surface text-ink hover:bg-fill"
              }`}
            >
              <Icon name="calendar" size={20} />
            </button>
          )}
        </div>

        {calendarOpen && (
          <div className="space-y-3 lg:hidden">
            {calendar}
            <EntryStats stats={stats} />
          </div>
        )}

        {/* "1년 전 오늘" — the reason to keep a diary for years. Offered
            only when there is actually something to look back at. */}
        {anniversaries.length > 0 && !filtering && (
          <button
            type="button"
            onClick={() => setDateFilter({ kind: "anniversary", key: anniversaryKey(today) })}
            className="block w-full space-y-2 rounded-2xl bg-surface px-5 py-4 text-left transition-shadow hover:shadow-[0_0_0_1px_var(--line)] focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-bold">
                <Icon name="history" size={16} strokeWidth={2} />
                {anniversaries.map((year) => `${today.getFullYear() - year}년 전`).join(", ")} 오늘
              </span>
              {anniversaryQuote && <span className="text-[0.8125rem] text-ink-3">{anniversaryQuote.year}년</span>}
            </span>
            <span className="block text-lg leading-7 font-semibold tracking-[-0.015em]">
              {anniversaryQuote ? `“${anniversaryQuote.lead}”` : "그날에도 일기를 썼어요."}
            </span>
          </button>
        )}

        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 pl-1">
          <div className="flex flex-wrap items-center gap-2">
            {dateFilter.kind === "day" && (
              <button
                type="button"
                onClick={() => setDateFilter({ kind: "all" })}
                className={chipClass}
                aria-label={`${formatDayLabel(dateFilter.key)} 선택 풀기`}
              >
                {formatDayLabel(dateFilter.key)}
                <Icon name="close" size={16} strokeWidth={2.25} />
              </button>
            )}
            {dateFilter.kind === "anniversary" && (
              <button
                type="button"
                onClick={() => setDateFilter({ kind: "all" })}
                className={chipClass}
                aria-label="지난해 오늘 선택 풀기"
              >
                지난해 오늘
                <Icon name="close" size={16} strokeWidth={2.25} />
              </button>
            )}
            <p className="text-sm text-ink-3 tabular-nums" aria-live="polite">
              {filtering
                ? `${searching ? `‘${deferredQuery.trim()}’ ` : ""}일기 ${prepared.length.toLocaleString("ko-KR")}개`
                : `일기 ${total.toLocaleString("ko-KR")}개`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSortOrder((order) => (order === "newest" ? "oldest" : "newest"))}
            className="btn-text -mr-2 text-sm"
            aria-label={`정렬: ${sortOrder === "newest" ? "최신순" : "오래된순"} (눌러서 바꾸기)`}
          >
            <Icon name="sort" size={16} />
            {sortOrder === "newest" ? "최신순" : "오래된순"}
          </button>
        </div>

        {/* Decryption usually finishes in well under the 10 seconds after
            which a progress indicator earns its place; until then the
            cards themselves show what is still opening. */}
        {searching && !done && (
          <p className="text-sm text-ink-3">아직 여는 중인 일기는 검색되지 않아요. 다 열리면 결과가 더 나올 수 있어요.</p>
        )}

        {integrity && !integrity.ok && (
          <div role="alert" className="note-warn">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-bold">
                {integrity.missingTailCount > 0 || integrity.missingSeqs.length > 0
                  ? "불러오지 못한 일기가 있어요"
                  : "같은 일기가 두 번 불러와졌어요"}
              </p>
              {integrity.missingTailCount > 0 && (
                <p>저장된 것보다 {integrity.missingTailCount}개 적게 불러왔어요.</p>
              )}
              {integrity.missingSeqs.length > 0 && <p>빠진 순번: {integrity.missingSeqs.join(", ")}</p>}
              {integrity.duplicateSeqs.length > 0 && <p>겹친 순번: {integrity.duplicateSeqs.join(", ")}</p>}
              <p>불러온 일기는 모두 처음 저장한 그대로예요. 서버에서 일기가 빠졌거나 겹쳤을 수 있어요.</p>
            </div>
          </div>
        )}

        {done && failedCount > 0 && (
          <p role="alert" className="flex gap-2 text-sm text-danger">
            <Icon name="alert" size={18} className="mt-px shrink-0" />
            일기 {failedCount}개를 열지 못했어요. 해당 일기에 표시해 두었어요.
          </p>
        )}

        {filtering && prepared.length === 0 && (
          <div className="space-y-1.5 rounded-2xl bg-surface px-5 py-9 text-center">
            <p className="text-base font-semibold">
              {!done
                ? "아직 찾는 중이에요"
                : searching
                  ? `‘${deferredQuery.trim()}’가 들어간 일기가 없어요`
                  : "이날 쓴 일기가 없어요"}
            </p>
            <p className="text-sm text-ink-3">
              {!done ? "일기가 다 열리면 결과가 더 나올 수 있어요." : "다른 낱말로 찾아보세요."}
            </p>
          </div>
        )}

        <ol className="space-y-2">
          {rows.map((row) =>
            row.kind === "month" ? (
              <li key={`m-${row.key}`} className="flex items-baseline justify-between px-1 pb-1 pt-4 first:pt-1">
                <h2 className="text-[1.375rem] font-extrabold tracking-[-0.02em]">{row.label}</h2>
                <span className="text-[0.8125rem] font-medium text-ink-3">
                  {filtering ? `${row.count}개` : `${row.days}일 썼어요`}
                </span>
              </li>
            ) : (
              <EntryCard
                key={row.entry.id}
                createdAt={row.entry.createdAt}
                text={row.entry.text}
                error={row.entry.error}
                ranges={row.entry.ranges}
                searching={searching}
                showDate={row.showDate}
                onOpen={() => setReaderId(row.entry.id)}
              />
            )
          )}
        </ol>

        {/* Export is occasional, so it sits after the diary rather than in
            the toolbar above it. */}
        <div className="pt-6">
          {exportOpen ? (
            <ExportEntriesCard
              entries={exportable}
              disabled={!done}
              disabledReason="아직 일기를 여는 중이에요. 다 열린 뒤에 내보내야 빠짐없이 저장돼요."
              onClose={() => setExportOpen(false)}
            />
          ) : (
            <button type="button" onClick={() => setExportOpen(true)} className="btn-text">
              <Icon name="download" size={18} />
              일기 모두 내보내기
            </button>
          )}
        </div>
      </div>

      {/* Wide screens: calendar and totals stay in view while the list scrolls. */}
      <aside className="hidden space-y-3 lg:sticky lg:top-20 lg:block">
        {calendar}
        <EntryStats stats={stats} />
      </aside>
    </div>
  );
}
