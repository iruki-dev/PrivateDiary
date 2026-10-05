"use client";

import { useState } from "react";
import { HighlightedText } from "./HighlightedText";
import { buildSnippet, type MatchRange } from "@/lib/entries/search";

/**
 * One diary entry in the list.
 *
 * Long entries are clamped rather than dumped in full: the previous list
 * rendered every entry's entire body, so a year of diary-keeping was a
 * single unscannable wall of text with no way to see what was where. When a
 * search is active the card shows the window around the match instead of
 * the opening lines, so a hit buried deep in a long entry is visible
 * without expanding anything.
 */

/** Roughly the point past which a card stops being scannable in a list. */
const CLAMP_THRESHOLD = 400;

const timeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });

/** Time of day only — the day itself is the group heading above (EntryBrowser). */
function formatTime(date: Date | null): string {
  return date ? timeFormatter.format(date) : "저장 중...";
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
}

export function EntryCard({ createdAt, text, error, ranges, searching }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const snippet = searching && text ? buildSnippet(text, ranges) : null;
  const body = expanded ? text : (snippet?.text ?? text);
  const bodyRanges = expanded
    ? ranges
    : (snippet?.ranges ?? ranges);
  const clamped = !expanded && !snippet && (text?.length ?? 0) > CLAMP_THRESHOLD;
  const canExpand = !expanded && (clamped || snippet?.truncatedStart || snippet?.truncatedEnd);

  return (
    <li className="px-4 py-4 sm:px-5">
      <p className="faint text-xs tabular-nums">{formatTime(createdAt)}</p>

      {error ? (
        <p className="mt-1.5 error-text">{error}</p>
      ) : text === null ? (
        <p className="mt-1.5 muted">여는 중...</p>
      ) : (
        <>
          <p className={`mt-1.5 whitespace-pre-wrap text-[0.9375rem] leading-7 ${clamped ? "line-clamp-6" : ""}`}>
            {snippet?.truncatedStart && !expanded ? "… " : ""}
            <HighlightedText text={body ?? ""} ranges={bodyRanges} />
            {snippet?.truncatedEnd && !expanded ? " …" : ""}
          </p>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 text-xs link"
            >
              전체 보기
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-2 text-xs link"
            >
              접기
            </button>
          )}
        </>
      )}
    </li>
  );
}
