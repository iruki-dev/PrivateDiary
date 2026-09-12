/**
 * Entry-sequence integrity checking (ARCHITECTURE.md §3.4).
 *
 * Deliberately kept in its own module with NO Firebase imports: pulling in
 * ./config initializes the Firebase app (and Auth, which throws without a
 * real API key), so co-locating this pure logic with the Firestore I/O in
 * ./entries.ts would make it untestable outside a browser. ./entries.ts
 * re-exports it so callers still have a single import site.
 */

/**
 * Integrity check over the sequence numbers of the entries that came back
 * (ARCHITECTURE.md §3.4).
 *
 * AES-GCM's AAD binding proves an individual entry wasn't altered, but it
 * says nothing about entries that are simply ABSENT — a backend that drops
 * or withholds documents produces a list that decrypts perfectly. entrySeq
 * is a dense 1..N counter, so gaps, duplicates, and a list that stops short
 * of users/{uid}.lastEntrySeq are all detectable client-side. That's
 * detection, not prevention: the fix for prevention is a signed manifest
 * (the unused `signingPublicKey` in the original schema was headed that
 * way), which would change the storage format.
 */
export interface EntrySequenceIntegrity {
  ok: boolean;
  /** Sequence numbers that should exist between 1 and the highest seen, but don't. */
  missingSeqs: number[];
  /** Sequence numbers that appear on more than one entry. */
  duplicateSeqs: number[];
  /** Entries the counter says were written but that came back missing from the tail. */
  missingTailCount: number;
}

export function checkEntrySequence(
  // Structural, not `Pick<StoredEntry, ...>`: keeping this module free of
  // any import from ./entries is what lets it be tested without booting
  // the Firebase app. StoredEntry satisfies it by shape.
  entries: readonly { entrySeq: number }[],
  lastEntrySeq: number | null
): EntrySequenceIntegrity {
  const seen = new Map<number, number>();
  for (const entry of entries) {
    seen.set(entry.entrySeq, (seen.get(entry.entrySeq) ?? 0) + 1);
  }
  const duplicateSeqs = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([seq]) => seq)
    .sort((a, b) => a - b);

  const highestSeen = entries.length === 0 ? 0 : Math.max(...seen.keys());
  const missingSeqs: number[] = [];
  for (let seq = 1; seq <= highestSeen; seq += 1) {
    if (!seen.has(seq)) missingSeqs.push(seq);
  }

  // Only meaningful once the counter exists; `null` means this account
  // predates it and the tail can't be checked (see getNextEntrySeq).
  const missingTailCount =
    lastEntrySeq === null ? 0 : Math.max(0, lastEntrySeq - highestSeen);

  return {
    ok: missingSeqs.length === 0 && duplicateSeqs.length === 0 && missingTailCount === 0,
    missingSeqs,
    duplicateSeqs,
    missingTailCount,
  };
}
