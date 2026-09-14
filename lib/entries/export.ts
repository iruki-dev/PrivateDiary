/**
 * Builds a downloadable, DECRYPTED archive of the diary.
 *
 * Why this exists at all in a zero-knowledge app: ARCHITECTURE.md §3.6 rule
 * 5 and §9 are blunt that losing both the passphrase and the backup codes
 * means the entries are gone forever, and §1.1 rule 4 calls that a design
 * goal rather than a bug. A design that can genuinely destroy your data on
 * a forgotten password has to give you a way to hold a copy yourself —
 * otherwise "your data, only yours" quietly means "your data, until you
 * slip". Export is the escape hatch that makes the strictness acceptable.
 *
 * What it produces is plaintext, by definition — the whole point is a file
 * that survives without this app or its keys. The UI is responsible for
 * saying so before the download starts; this module only serializes.
 *
 * Pure: no crypto, Firebase, DOM or React imports, so it unit-tests
 * directly. The caller passes entries that are already decrypted.
 */

export interface ExportableEntry {
  id: string;
  entrySeq: number;
  /** null only for an entry whose serverTimestamp() hasn't resolved yet. */
  createdAt: Date | null;
  text: string;
}

export type ExportFormat = "markdown" | "json";

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "2026-09-14 09:58" — local time, matching what the entry list shows. */
function localTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${isoDay(date)} ${hours}:${minutes}`;
}

/**
 * Oldest-first, which is the reading order for an archive even though the
 * app's own list is newest-first. Sorted by entrySeq rather than createdAt
 * because entrySeq is the authoritative monotonic order (§3.4) and is
 * present even on an entry whose timestamp hasn't resolved.
 */
function chronological(entries: readonly ExportableEntry[]): ExportableEntry[] {
  return [...entries].sort((a, b) => a.entrySeq - b.entrySeq);
}

function buildMarkdown(entries: readonly ExportableEntry[], exportedAt: Date): string {
  const lines = [
    "# PrivateDiary 내보내기",
    "",
    `- 내보낸 시각: ${localTimestamp(exportedAt)}`,
    `- 일기 수: ${entries.length}개`,
    "",
    "> 이 파일은 **암호화되어 있지 않습니다.** 누구든 이 파일을 열면 내용을 그대로 읽을 수 있습니다.",
    "> 암호화된 저장소나 오프라인 매체에 보관하세요.",
    "",
    "---",
    "",
  ];
  for (const entry of chronological(entries)) {
    lines.push(`## ${entry.createdAt ? localTimestamp(entry.createdAt) : "(시각 미확정)"}`);
    lines.push("");
    lines.push(entry.text);
    lines.push("");
  }
  return lines.join("\n");
}

function buildJson(entries: readonly ExportableEntry[], exportedAt: Date): string {
  return JSON.stringify(
    {
      format: "privatediary-export",
      version: 1,
      exportedAt: exportedAt.toISOString(),
      warning: "This file is NOT encrypted. Anyone who opens it can read every entry.",
      entryCount: entries.length,
      entries: chronological(entries).map((entry) => ({
        id: entry.id,
        entrySeq: entry.entrySeq,
        createdAt: entry.createdAt ? entry.createdAt.toISOString() : null,
        text: entry.text,
      })),
    },
    null,
    2
  );
}

export function buildExportFile(
  entries: readonly ExportableEntry[],
  format: ExportFormat,
  exportedAt: Date = new Date()
): ExportFile {
  const stamp = isoDay(exportedAt);
  return format === "json"
    ? {
        filename: `privatediary-${stamp}.json`,
        // charset is explicit because the content is overwhelmingly Korean
        // and a bare application/json saved by some browsers has been known
        // to be reopened as latin-1.
        mimeType: "application/json;charset=utf-8",
        content: buildJson(entries, exportedAt),
      }
    : {
        filename: `privatediary-${stamp}.md`,
        mimeType: "text/markdown;charset=utf-8",
        content: buildMarkdown(entries, exportedAt),
      };
}
