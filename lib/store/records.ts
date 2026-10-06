/**
 * The on-phone record shapes (lib/store/local.ts, lib/store/backup.ts) and
 * their conversion to what the rest of the app reads. Pure — no IndexedDB,
 * no Firebase — so it unit-tests directly.
 *
 * The shapes are the same base64 storage forms Firestore holds
 * (lib/crypto/codec.ts), so a record here is byte-for-byte what the server
 * would have, and nothing more.
 */
import {
  entryFromStorage,
  entryToStorage,
  randomId,
  publicKeysFromStorage,
  publicKeysToStorage,
  shamirWrappedSeedFromStorage,
  shamirWrappedSeedToStorage,
  wrappedSeedFromStorage,
  wrappedSeedToStorage,
  type EncryptedEntryStorage,
  type HybridPublicKeysStorage,
  type ShamirWrappedSeedStorage,
  type WrappedSeedStorage,
} from "@/lib/crypto";
import { checkEntrySequence } from "@/lib/firebase/entrySequence";
import type { EntryList, EntryTimestamp, StoredEntry, UserKeyRecord } from "./types";

export interface KeyRecordStorage {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  shamir: { n: number; k: number; wrappedSeed: ShamirWrappedSeedStorage } | null;
}

export interface EntryRecord {
  id: string;
  entrySeq: number;
  /** Milliseconds since the epoch; null for a cloud entry whose server time hadn't resolved when copied. */
  createdAt: number | null;
  storage: EncryptedEntryStorage;
}

export function keyRecordFromStorage(stored: KeyRecordStorage): UserKeyRecord {
  return {
    publicKeys: publicKeysFromStorage(stored.publicKeys),
    wrappedSeed: wrappedSeedFromStorage(stored.wrappedSeed),
    decryptionMethods: { shamir: stored.shamir ? { n: stored.shamir.n, k: stored.shamir.k } : null },
    shamirWrappedSeed: stored.shamir ? shamirWrappedSeedFromStorage(stored.shamir.wrappedSeed) : null,
  };
}

/** A Firestore-Timestamp-shaped stand-in, so every screen reads `createdAt.toDate()` the same way. */
export function timestampFromMillis(ms: number): EntryTimestamp {
  return { toDate: () => new Date(ms) };
}

/**
 * Newest first, like lib/firebase/entries.ts's query (entrySeq desc), with
 * the same per-entry decode isolation: one record that won't decode shows
 * up as one unreadable entry instead of taking the whole list down.
 */
export function entryListFromRecords(owner: string, records: readonly EntryRecord[], lastEntrySeq: number | null): EntryList {
  const entries = [...records]
    .sort((a, b) => b.entrySeq - a.entrySeq)
    .map((record): StoredEntry => {
      const metadata = {
        id: record.id,
        uid: owner,
        entrySeq: record.entrySeq,
        createdAt: record.createdAt === null ? null : timestampFromMillis(record.createdAt),
      };
      try {
        return { ...metadata, payload: entryFromStorage(record.storage) };
      } catch {
        return { ...metadata, payload: null };
      }
    });
  return { entries, integrity: checkEntrySequence(entries, lastEntrySeq) };
}

/** Local diaries' ids: also the AAD `uid` of their entries, and the biometric check's account name. */
export function newLocalDiaryId(): string {
  return `local-${randomId(12)}`;
}

/** Entry ids for on-phone diaries: random, like Firestore's auto ids. */
export function newEntryId(): string {
  return randomId(10);
}

export function keyRecordToStorage(record: UserKeyRecord): KeyRecordStorage {
  return {
    publicKeys: publicKeysToStorage(record.publicKeys),
    wrappedSeed: wrappedSeedToStorage(record.wrappedSeed),
    shamir:
      record.decryptionMethods.shamir && record.shamirWrappedSeed
        ? {
            n: record.decryptionMethods.shamir.n,
            k: record.decryptionMethods.shamir.k,
            wrappedSeed: shamirWrappedSeedToStorage(record.shamirWrappedSeed),
          }
        : null,
  };
}

/** A listed entry back in its storage form, for copying it to the phone. Null for one that didn't decode. */
export function entryRecordFromStored(entry: StoredEntry): EntryRecord | null {
  if (!entry.payload) return null;
  return {
    id: entry.id,
    entrySeq: entry.entrySeq,
    createdAt: entry.createdAt ? entry.createdAt.toDate().getTime() : null,
    storage: entryToStorage(entry.payload),
  };
}
