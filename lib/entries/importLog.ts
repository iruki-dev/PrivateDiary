/**
 * How many entries this device imported into a diary in the last 24
 * hours. The server's daily limit (functions/src/entryRateLimit.ts) counts
 * every created entry, but an imported entry carries its original date, so
 * the entry list alone can't show how many were created today. Kept per
 * diary id in local storage; only counts, never content.
 */

const KEY_PREFIX = "privatediary:imports:v1:";
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface ImportRecord {
  at: number;
  count: number;
}

function read(ownerId: string): ImportRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + ownerId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is ImportRecord =>
            typeof r === "object" && r !== null && typeof r.at === "number" && typeof r.count === "number"
        )
      : [];
  } catch {
    return [];
  }
}

export function importedRecently(ownerId: string, now = Date.now()): number {
  return read(ownerId)
    .filter((record) => now - record.at < WINDOW_MS)
    .reduce((sum, record) => sum + record.count, 0);
}

export function recordImport(ownerId: string, count: number, now = Date.now()): void {
  if (count <= 0) return;
  try {
    const kept = read(ownerId).filter((record) => now - record.at < WINDOW_MS);
    window.localStorage.setItem(KEY_PREFIX + ownerId, JSON.stringify([...kept, { at: now, count }]));
  } catch {
    // Storage blocked: the estimate is simply lower.
  }
}
