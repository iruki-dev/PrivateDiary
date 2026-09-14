/**
 * Client-side search and date grouping over ALREADY-DECRYPTED entries.
 *
 * ARCHITECTURE.md §9 names this as a permanent consequence of the design:
 * the server only ever holds ciphertext, so it can never answer a query.
 * Search has to happen in the browser, after the seed is unlocked, over
 * plaintext that exists only in memory. That makes this module part of the
 * read path's UX, not its security — it is deliberately free of any crypto,
 * Firebase or React import so it stays pure and unit-testable.
 */

export interface SearchableEntry {
  id: string;
  text: string;
}

/** A [start, end) slice of a string that matched the query. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * Case- and width-insensitive normalization. NFC matters for Korean: the
 * same syllable can arrive as a precomposed character or as decomposed
 * jamo depending on the input method (macOS IMEs famously produce NFD),
 * and those compare unequal byte-for-byte. Normalizing both sides makes
 * "한글" typed on a Mac find "한글" typed on Windows.
 *
 * Crucially the normalized string must stay INDEX-ALIGNED with the source
 * so match offsets can be applied to the original text for highlighting —
 * which is why this only does NFC + lowercase (both length-preserving for
 * the scripts this app sees) rather than stripping punctuation.
 */
function normalize(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

/**
 * Splits a query into terms. Multiple terms are ANDed (every term must
 * appear somewhere in the entry) — the behaviour people expect from a
 * search box, and the useful one for a diary where you remember two
 * details about an entry but not a phrase.
 */
export function parseQuery(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/** Every occurrence of `term` in `text`, as ranges into the ORIGINAL text. */
function findTerm(normalizedText: string, term: string): MatchRange[] {
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const index = normalizedText.indexOf(term, from);
    if (index === -1) break;
    ranges.push({ start: index, end: index + term.length });
    // Advance by one, not by term.length: overlapping occurrences of a
    // repeated-character term ("aa" in "aaa") are still two real hits, and
    // mergeRanges below collapses whatever overlaps.
    from = index + 1;
  }
  return ranges;
}

/** Sorts and merges overlapping/adjacent ranges so highlighting never nests. */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MatchRange[] = [sorted[0]];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Match ranges for `query` within `text`, or null if any term is absent
 * (i.e. the entry does not match at all). Returning null rather than an
 * empty array lets callers distinguish "no match" from "empty query", which
 * matches everything with nothing to highlight.
 */
export function matchEntry(text: string, terms: string[]): MatchRange[] | null {
  if (terms.length === 0) return [];
  const normalizedText = normalize(text);
  const ranges: MatchRange[] = [];
  for (const term of terms) {
    const found = findTerm(normalizedText, term);
    if (found.length === 0) return null;
    ranges.push(...found);
  }
  return mergeRanges(ranges);
}

/** One contiguous piece of text, flagged as matched or not, for rendering. */
export interface HighlightSegment {
  text: string;
  matched: boolean;
}

/** Splits `text` into alternating plain/matched segments for rendering. */
export function toHighlightSegments(text: string, ranges: MatchRange[]): HighlightSegment[] {
  if (ranges.length === 0) return [{ text, matched: false }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), matched: false });
    segments.push({ text: text.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  return segments;
}

export interface Snippet {
  text: string;
  ranges: MatchRange[];
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

/**
 * A window of `text` centred on the first match, so a hit buried 3,000
 * characters into a long entry is actually visible in the result list
 * instead of the reader having to expand the entry and hunt for it.
 * Returned ranges are re-based onto the snippet.
 */
export function buildSnippet(text: string, ranges: MatchRange[], radius = 90): Snippet {
  if (ranges.length === 0) {
    return { text, ranges: [], truncatedStart: false, truncatedEnd: false };
  }
  const first = ranges[0];
  const start = Math.max(0, first.start - radius);
  const end = Math.min(text.length, first.end + radius);
  return {
    text: text.slice(start, end),
    ranges: ranges
      .filter((range) => range.start < end && range.end > start)
      .map((range) => ({
        start: Math.max(0, range.start - start),
        end: Math.min(end - start, range.end - start),
      })),
    truncatedStart: start > 0,
    truncatedEnd: end < text.length,
  };
}

export interface MonthGroup<T> {
  /** Sortable "YYYY-MM" key. */
  key: string;
  /** Display label, e.g. "2026년 9월". */
  label: string;
  entries: T[];
}

/**
 * Groups entries into month buckets in the order they arrive (the entries
 * list is already newest-first), so the rendered list reads as a reverse
 * chronological timeline with month headers.
 *
 * Entries whose createdAt is still null — a just-written entry whose
 * serverTimestamp() hasn't resolved on this client yet — land in their own
 * leading bucket rather than being dropped or crashing on .getFullYear().
 */
export function groupByMonth<T extends { createdAt: Date | null }>(
  entries: readonly T[]
): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  const byKey = new Map<string, MonthGroup<T>>();
  for (const entry of entries) {
    const { key, label } = entry.createdAt
      ? {
          key: `${entry.createdAt.getFullYear()}-${String(entry.createdAt.getMonth() + 1).padStart(2, "0")}`,
          label: `${entry.createdAt.getFullYear()}년 ${entry.createdAt.getMonth() + 1}월`,
        }
      : { key: "pending", label: "저장 중" };
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}
