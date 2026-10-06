import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";
import { getLastEntrySeq } from "./users";
import { checkEntrySequence, type EntrySequenceIntegrity } from "./entrySequence";
import { assertNativeIntegrity } from "@/lib/security/nativeIntegrity";
export { checkEntrySequence } from "./entrySequence";
export type { EntrySequenceIntegrity } from "./entrySequence";

import {
  encryptEntry,
  entryFromStorage,
  entryToStorage,
  type EncryptedEntryStorage,
  type EntryAAD,
  type HybridPublicKeysRaw,
} from "@/lib/crypto";
import type { StoredEntry, StoredEntryMetadata, WriteEntryOptions } from "@/lib/store/types";

/**
 * `entries` collection I/O (ARCHITECTURE.md §4, §5: append-only — no
 * update/delete anywhere in this file, matching the Firestore rules).
 *
 * Calls into lib/crypto's public API (encryptEntry / entry codec) rather
 * than bypassing it — that's the intended way for other modules to use
 * lib/crypto (rule 3 bars direct Web Crypto/PQC calls outside lib/crypto,
 * not calls to lib/crypto's own exported functions). This file never
 * imports decryptEntry or touches private keys — writing works from any
 * logged-in device with only the recipient's public keys (rule 5).
 */

interface EntryDocData extends EncryptedEntryStorage {
  uid: string;
  entrySeq: number;
  createdAt: Timestamp;
}

export type { StoredEntry, StoredEntryMetadata } from "@/lib/store/types";

/** What writeEntryRecord stored, for the phone's own copy of the diary (lib/store/backup.ts). */
export interface WrittenEntry {
  id: string;
  entrySeq: number;
  createdAt: Date;
  storage: EncryptedEntryStorage;
}

/**
 * Next entrySeq for this uid (§3.4's rollback-detection AAD binding).
 *
 * Reads the counter on users/{uid} rather than querying the `entries`
 * collection: `entries` reads are behind firestore.rules' OTP gate, but
 * writing an entry must work without any unlock step (ARCHITECTURE.md §3.2
 * rule 5), so sourcing the number from a gated read made every write fail
 * for an OTP-enabled account that hadn't verified yet.
 *
 * The query fallback covers accounts created before `lastEntrySeq`
 * existed; it needs the OTP gate satisfied exactly as the old code did, and
 * only runs until that account's first write seeds the counter.
 *
 * Assignment still isn't transactionally exclusive — two devices writing at
 * the same instant can read the same counter — but that's a bookkeeping
 * edge case, not a security boundary: the AAD binding still catches any
 * post-write tampering with a stored entrySeq regardless of how the number
 * was assigned, and checkEntrySequence() below surfaces any collision that
 * does slip through.
 */
async function getNextEntrySeq(uid: string): Promise<number> {
  const counter = await getLastEntrySeq(uid);
  if (counter !== null) {
    return counter + 1;
  }

  const lastEntryQuery = query(
    collection(db, "entries"),
    where("uid", "==", uid),
    orderBy("entrySeq", "desc"),
    limit(1)
  );
  const snapshot = await getDocs(lastEntryQuery);
  if (snapshot.empty) {
    return 1;
  }
  const last = snapshot.docs[0].data() as EntryDocData;
  return last.entrySeq + 1;
}

/**
 * Encrypts and writes one diary entry (ARCHITECTURE.md §3.2). Needs only
 * the recipient's public keys — works while the seed is locked.
 *
 * `options.createdAt` is for entries brought in from an export file
 * (lib/entries/import.ts): they keep the moment they were first written,
 * both in the stored timestamp (so the calendar files them under their own
 * day) and in the authenticated AAD. firestore.rules has never required
 * `createdAt` to be the server's clock — only a timestamp — and the AAD
 * value was always client-chosen; an imported entry still gets the next
 * entrySeq, so the sequence check is unaffected.
 */
export async function writeEntryRecord(
  uid: string,
  recipientPublicKeys: HybridPublicKeysRaw,
  plaintext: string,
  options: WriteEntryOptions = {}
): Promise<WrittenEntry> {
  // lib/security/nativeIntegrity.ts: refuses to encrypt (and therefore to
  // hand the plaintext to encryptEntry at all) if a security-critical API
  // this app's own crypto depends on has been tampered with.
  assertNativeIntegrity();
  const entrySeq = await getNextEntrySeq(uid);
  const writtenAt = options.createdAt ?? new Date();
  const aad: EntryAAD = { uid, entrySeq, createdAt: writtenAt.toISOString() };

  const payload = await encryptEntry(recipientPublicKeys, plaintext, aad);
  const storage = entryToStorage(payload);

  const docData: Omit<EntryDocData, "createdAt"> & { createdAt: ReturnType<typeof serverTimestamp> | Timestamp } = {
    ...storage,
    uid,
    entrySeq,
    createdAt: options.createdAt ? Timestamp.fromDate(options.createdAt) : serverTimestamp(),
  };

  // One batch so the entry and the counter that allocated its sequence
  // number can't diverge: a bare entry write followed by a failed counter
  // bump would hand the same entrySeq to the next write.
  const ref = doc(collection(db, "entries"));
  const batch = writeBatch(db);
  batch.set(ref, docData);
  batch.update(doc(db, "users", uid), { lastEntrySeq: entrySeq });
  await batch.commit();
  return { id: ref.id, entrySeq, createdAt: writtenAt, storage };
}

/** writeEntryRecord, for callers that only need the new entry's id. */
export async function writeEntry(
  uid: string,
  recipientPublicKeys: HybridPublicKeysRaw,
  plaintext: string,
  options: WriteEntryOptions = {}
): Promise<string> {
  return (await writeEntryRecord(uid, recipientPublicKeys, plaintext, options)).id;
}

/**
 * Lists this user's entries (still encrypted — decrypting is a separate,
 * explicit step the UI performs with unwrapped private keys; see
 * ARCHITECTURE.md §3.3 / Phase 5's "본문은 절대 노출하지 않음").
 *
 * security-patch-v2 / H2: entryFromStorage() (base64 decode) used to run
 * unguarded inside this map. firestore.rules now rejects non-base64
 * ciphertext/key fields at write time, but entries are append-only and
 * undeletable, so a document written before that rule existed — or one
 * that slips through some future rules regression — must not be allowed
 * to take the ENTIRE list down with it: base64ToBytes throws on the first
 * invalid character, an unguarded Array.map has no per-element recovery,
 * and the caller's blanket .catch() (app/entries/page.tsx) would then
 * render as if the diary were completely empty, hiding every OTHER
 * perfectly-fine entry along with it. Isolating the decode per-entry means
 * one bad document surfaces as one bad entry (payload: null — see
 * StoredEntry) instead of erasing the whole list.
 */
export async function listEntries(
  uid: string
): Promise<{ entries: StoredEntry[]; integrity: EntrySequenceIntegrity }> {
  const entriesQuery = query(
    collection(db, "entries"),
    where("uid", "==", uid),
    orderBy("entrySeq", "desc")
  );
  const [snapshot, lastEntrySeq] = await Promise.all([
    getDocs(entriesQuery),
    getLastEntrySeq(uid).catch(() => null),
  ]);
  const entries = snapshot.docs.map((docSnapshot): StoredEntry => {
    const data = docSnapshot.data() as EntryDocData;
    const metadata: StoredEntryMetadata = {
      id: docSnapshot.id,
      uid: data.uid,
      entrySeq: data.entrySeq,
      createdAt: data.createdAt,
    };
    try {
      return { ...metadata, payload: entryFromStorage(data) };
    } catch (err) {
      console.error(`entryFromStorage failed to decode entry ${docSnapshot.id}`, err);
      return { ...metadata, payload: null };
    }
  });
  return { entries, integrity: checkEntrySequence(entries, lastEntrySeq) };
}
