import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  groupByMonth,
  matchEntry,
  mergeRanges,
  parseQuery,
  toHighlightSegments,
} from "../search";

describe("parseQuery", () => {
  it("splits on whitespace and lowercases", () => {
    expect(parseQuery("  Hello   World ")).toEqual(["hello", "world"]);
  });

  it("returns no terms for an empty or whitespace-only query", () => {
    expect(parseQuery("")).toEqual([]);
    expect(parseQuery("   ")).toEqual([]);
  });
});

describe("matchEntry", () => {
  it("matches every occurrence of a term", () => {
    expect(matchEntry("abc abc", parseQuery("abc"))).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it("requires ALL terms to be present (AND, not OR)", () => {
    expect(matchEntry("비가 오는 날", parseQuery("비가 날"))).not.toBeNull();
    expect(matchEntry("비가 오는 날", parseQuery("비가 눈"))).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(matchEntry("Rainy Day", parseQuery("rainy"))).toEqual([{ start: 0, end: 5 }]);
  });

  it("finds NFD-composed Korean typed as NFC (and vice versa)", () => {
    // The same word, decomposed into jamo — what a macOS IME produces.
    const decomposed = "한글".normalize("NFD");
    expect(decomposed).not.toBe("한글");
    expect(matchEntry(decomposed, parseQuery("한글"))).not.toBeNull();
    expect(matchEntry("한글", parseQuery(decomposed))).not.toBeNull();
  });

  it("treats an empty query as matching everything with nothing highlighted", () => {
    expect(matchEntry("아무 내용", parseQuery(""))).toEqual([]);
  });
});

describe("mergeRanges", () => {
  it("merges overlapping ranges so highlights never nest", () => {
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 3, end: 8 }])).toEqual([
      { start: 0, end: 8 },
    ]);
  });

  it("keeps disjoint ranges separate and sorted", () => {
    expect(mergeRanges([{ start: 10, end: 12 }, { start: 0, end: 2 }])).toEqual([
      { start: 0, end: 2 },
      { start: 10, end: 12 },
    ]);
  });
});

describe("toHighlightSegments", () => {
  it("splits into alternating plain and matched pieces that rejoin to the original", () => {
    const text = "오늘은 비가 왔다";
    const ranges = matchEntry(text, parseQuery("비가")) ?? [];
    const segments = toHighlightSegments(text, ranges);

    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.matched).map((s) => s.text)).toEqual(["비가"]);
  });

  it("returns the whole text unmatched when there are no ranges", () => {
    expect(toHighlightSegments("일기", [])).toEqual([{ text: "일기", matched: false }]);
  });
});

describe("buildSnippet", () => {
  it("centres the window on the first match and re-bases the ranges onto it", () => {
    const text = `${"가".repeat(500)}찾는말${"나".repeat(500)}`;
    const ranges = matchEntry(text, parseQuery("찾는말")) ?? [];
    const snippet = buildSnippet(text, ranges, 10);

    expect(snippet.text).toBe(`${"가".repeat(10)}찾는말${"나".repeat(10)}`);
    expect(snippet.truncatedStart).toBe(true);
    expect(snippet.truncatedEnd).toBe(true);
    // The re-based range must still point at the match inside the snippet.
    const { start, end } = snippet.ranges[0];
    expect(snippet.text.slice(start, end)).toBe("찾는말");
  });

  it("returns the text untouched when there is nothing to centre on", () => {
    const snippet = buildSnippet("짧은 일기", [], 10);
    expect(snippet).toEqual({
      text: "짧은 일기",
      ranges: [],
      truncatedStart: false,
      truncatedEnd: false,
    });
  });
});

describe("groupByMonth", () => {
  it("buckets by calendar month, preserving the incoming (newest-first) order", () => {
    const groups = groupByMonth([
      { createdAt: new Date(2026, 8, 14) },
      { createdAt: new Date(2026, 8, 1) },
      { createdAt: new Date(2026, 7, 30) },
    ]);

    expect(groups.map((g) => g.label)).toEqual(["2026년 9월", "2026년 8월"]);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].entries).toHaveLength(1);
  });

  it("puts entries with an unresolved server timestamp in their own bucket", () => {
    const groups = groupByMonth([{ createdAt: null }, { createdAt: new Date(2026, 8, 14) }]);

    expect(groups.map((g) => g.key)).toEqual(["pending", "2026-09"]);
  });
});
