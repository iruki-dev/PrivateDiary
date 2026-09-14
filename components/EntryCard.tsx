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

function formatTimestamp(date: Date | null): string {
  if (!date) return "저장 중...";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
    <li className="card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-zinc-400">{formatTimestamp(createdAt)}</p>
        {/* Computed from plaintext already in memory, and only once
            decrypted. It discloses nothing further: AES-GCM does not pad,
            so the stored ciphertext length already tells anyone with
            database access roughly how long each entry is (ARCHITECTURE.md
            §9). */}
        {text !== null && !error && (
          <p className="shrink-0 text-xs text-zinc-400 tabular-nums">
            {text.length.toLocaleString("ko-KR")}자
          </p>
        )}
      </div>

      {error ? (
        <p className="mt-2 error-text">{error}</p>
      ) : text === null ? (
        <p className="mt-2 muted italic">복호화하는 중...</p>
      ) : (
        <>
          <p className={`mt-2 whitespace-pre-wrap text-sm ${clamped ? "line-clamp-6" : ""}`}>
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
