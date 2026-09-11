import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./config";
import {
  encryptEntry,
  entryFromStorage,
  entryToStorage,
  type EncryptedEntryPayload,
  type EncryptedEntryStorage,
  type EntryAAD,
  type HybridPublicKeysRaw,
} from "@/lib/crypto";

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

export interface StoredEntryMetadata {
  id: string;
  uid: string;
  entrySeq: number;
  createdAt: Timestamp;
}

export interface StoredEntry extends StoredEntryMetadata {
  payload: EncryptedEntryPayload;
}

/**
 * Next entrySeq for this uid (§3.4's rollback-detection AAD binding).
 * Assignment isn't transactionally exclusive — a race between two
 * simultaneous writes on different devices could pick the same number —
 * but that's a bookkeeping edge case, not a security boundary: the AAD
 * binding still catches any post-write tampering with a stored entrySeq
 * regardless of how the number was originally assigned.
 */
async function getNextEntrySeq(uid: string): Promise<number> {
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
 */
export async function writeEntry(
  uid: string,
  recipientPublicKeys: HybridPublicKeysRaw,
  plaintext: string
): Promise<string> {
  const entrySeq = await getNextEntrySeq(uid);
  const aad: EntryAAD = { uid, entrySeq, createdAt: new Date().toISOString() };

  const payload = await encryptEntry(recipientPublicKeys, plaintext, aad);
  const storage = entryToStorage(payload);

  const docData: Omit<EntryDocData, "createdAt"> & { createdAt: ReturnType<typeof serverTimestamp> } = {
    ...storage,
    uid,
    entrySeq,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "entries"), docData);
  return ref.id;
}

/**
 * Lists this user's entries (still encrypted — decrypting is a separate,
 * explicit step the UI performs with unwrapped private keys; see
 * ARCHITECTURE.md §3.3 / Phase 5's "본문은 절대 노출하지 않음").
 */
export async function listEntries(uid: string): Promise<StoredEntry[]> {
  const entriesQuery = query(
    collection(db, "entries"),
    where("uid", "==", uid),
    orderBy("entrySeq", "desc")
  );
  const snapshot = await getDocs(entriesQuery);
  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data() as EntryDocData;
    return {
      id: docSnapshot.id,
      uid: data.uid,
      entrySeq: data.entrySeq,
      createdAt: data.createdAt,
      payload: entryFromStorage(data),
    };
  });
}
