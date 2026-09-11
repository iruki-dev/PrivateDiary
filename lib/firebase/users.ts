import { doc, getDoc } from "firebase/firestore";
import { db } from "./config";
import {
  publicKeysFromStorage,
  wrappedSeedFromStorage,
  type HybridPublicKeysRaw,
  type HybridPublicKeysStorage,
  type WrappedSeed,
  type WrappedSeedStorage,
} from "@/lib/crypto";

/**
 * Read-side only for now (ARCHITECTURE.md §4 `users/{uid}` schema). Writing
 * the key-issuance document (Phase 4 onboarding) and the append-only
 * `entries` collection + its security rules land in Phase 3/4 — this file
 * exists early because SeedContext needs to know whether a user has already
 * issued keys to compute its "발급됨/미발급" status.
 *
 * This module — like the rest of lib/firebase — never imports lib/crypto's
 * decryption/unwrap functions and performs no cryptography itself; it only
 * shuttles the already-encrypted storage shapes to/from Firestore.
 */

interface UserDocData {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  createdAt?: unknown;
}

export interface UserKeyRecord {
  publicKeys: HybridPublicKeysRaw;
  wrappedSeed: WrappedSeed;
}

/** Returns null if the user hasn't completed key issuance yet (ARCHITECTURE.md §3.1). */
export async function getUserKeyRecord(uid: string): Promise<UserKeyRecord | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) {
    return null;
  }
  const data = snapshot.data() as UserDocData;
  return {
    publicKeys: publicKeysFromStorage(data.publicKeys),
    wrappedSeed: wrappedSeedFromStorage(data.wrappedSeed),
  };
}
