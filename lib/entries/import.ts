/**
 * "불러오기": reading an export file back into a diary.
 *
 * Accepts the JSON export (lib/entries/export.ts) and the locked export
 * (lib/crypto/archive.ts), whose inside is that same JSON. The Markdown
 * export is for reading, not for coming back: its headings can't be told
 * apart from a "## " someone wrote in an entry, so it isn't accepted.
 *
 * Entries already in the diary are skipped — same moment and same text —
 * so importing a file twice, or importing into the diary it came from,
 * adds nothing. That is also what makes an import that stopped halfway
 * safe to simply run again.
 *
 * Pure: no crypto, Firebase, DOM or React imports. The caller decrypts a
 * locked file (lib/crypto) and writes the planned entries through the
 * diary's store, which encrypts each one for that diary's keys.
 */
import { isLockedExport, type LockedExportFile } from "@/lib/crypto";

export interface ImportableEntry {
  /** null for an entry exported before its time was known; it is imported as "now". */
  createdAt: Date | null;
  text: string;
}

export type ParsedImportFile =
  | { kind: "plain"; entries: ImportableEntry[] }
  | { kind: "locked"; file: LockedExportFile };

export class InvalidImportFileError extends Error {
  constructor(message = "This isn't a PrivateDiary export file.") {
    super(message);
    this.name = "InvalidImportFileError";
  }
}

/** The JSON export format this reads (lib/entries/export.ts). */
const PLAIN_FORMAT = "privatediary-export";

/** Far past any real diary; refuses to queue a file that would take hours to write. */
export const MAX_IMPORT_ENTRIES = 20_000;
/** The same ceiling a written entry has (firestore.rules caps the padded ciphertext). */
export const MAX_IMPORT_ENTRY_CHARS = 200_000;

function parseJson(content: string): unknown {
  try {
    // A file saved by some editors starts with a byte-order mark.
    return JSON.parse(content.replace(/^﻿/, ""));
  } catch {
    throw new InvalidImportFileError();
  }
}

/** Reads the entries of a plain JSON export (already parsed). */
export function entriesFromPlainExport(value: unknown): ImportableEntry[] {
  if (typeof value !== "object" || value === null) throw new InvalidImportFileError();
  const file = value as Record<string, unknown>;
  if (file.format !== PLAIN_FORMAT || file.version !== 1 || !Array.isArray(file.entries)) {
    throw new InvalidImportFileError();
  }
  if (file.entries.length > MAX_IMPORT_ENTRIES) {
    throw new InvalidImportFileError("Too many entries in one file.");
  }
  const entries: ImportableEntry[] = [];
  for (const raw of file.entries) {
    if (typeof raw !== "object" || raw === null) throw new InvalidImportFileError();
    const entry = raw as Record<string, unknown>;
    if (typeof entry.text !== "string") throw new InvalidImportFileError();
    if (!entry.text.trim()) continue;
    if (entry.text.length > MAX_IMPORT_ENTRY_CHARS) {
      throw new InvalidImportFileError("An entry is too long to import.");
    }
    let createdAt: Date | null = null;
    if (typeof entry.createdAt === "string") {
      const parsed = new Date(entry.createdAt);
      if (Number.isNaN(parsed.getTime())) throw new InvalidImportFileError();
      createdAt = parsed;
    } else if (entry.createdAt !== null && entry.createdAt !== undefined) {
      throw new InvalidImportFileError();
    }
    entries.push({ createdAt, text: entry.text });
  }
  return entries;
}

/** What kind of export `content` is: entries ready to plan, or a locked file that needs its password. */
export function parseImportFile(content: string): ParsedImportFile {
  const value = parseJson(content);
  if (isLockedExport(value)) return { kind: "locked", file: value };
  return { kind: "plain", entries: entriesFromPlainExport(value) };
}

/** What unlocking a locked file gives back: the plain JSON export inside it. */
export function entriesFromUnlockedExport(content: string): ImportableEntry[] {
  return entriesFromPlainExport(parseJson(content));
}

function sameEntryKey(createdAt: Date | null, text: string): string {
  // NFC: the same Korean text typed on different systems can arrive in
  // different Unicode forms (lib/entries/search.ts has the same concern).
  return `${createdAt ? createdAt.getTime() : "?"}\u0000${text.normalize("NFC")}`;
}

export interface ImportPlan {
  /** New entries, oldest first — the order they are written in, so entrySeq follows time. */
  toAdd: ImportableEntry[];
  /** Entries that are already in the diary (or repeated within the file). */
  skipped: number;
}

export function planImport(
  existing: readonly { createdAt: Date | null; text: string }[],
  incoming: readonly ImportableEntry[]
): ImportPlan {
  const seen = new Set(existing.map((entry) => sameEntryKey(entry.createdAt, entry.text)));
  const toAdd: ImportableEntry[] = [];
  let skipped = 0;
  for (const entry of incoming) {
    const key = sameEntryKey(entry.createdAt, entry.text);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    toAdd.push(entry);
  }
  // Entries without a time go last: they are written as "now".
  toAdd.sort((a, b) => (a.createdAt?.getTime() ?? Infinity) - (b.createdAt?.getTime() ?? Infinity));
  return { toAdd, skipped };
}

/**
 * How many entries the server would still accept in its rolling 24-hour
 * window (functions/src/entryRateLimit.ts deletes whatever goes past the
 * account's own "하루에 쓸 수 있는 일기"). `limit` 0 means no limit.
 * `writtenRecently` is the client's best count of entries created in the
 * window (it can't see the server's counter), so the answer errs low.
 */
export function importAllowance(limit: number, writtenRecently: number): number {
  if (limit <= 0) return Infinity;
  return Math.max(0, limit - writtenRecently);
}
