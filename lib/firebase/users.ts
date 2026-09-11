import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "./config";
import {
  publicKeysFromStorage,
  publicKeysToStorage,
  wrappedSeedFromStorage,
  wrappedSeedToStorage,
  type HybridPublicKeysRaw,
  type HybridPublicKeysStorage,
  type WrappedSeed,
  type WrappedSeedStorage,
} from "@/lib/crypto";

/**
 * `users/{uid}` document I/O (ARCHITECTURE.md §4). This module — like the
 * rest of lib/firebase — never imports lib/crypto's decryption/unwrap
 * functions and performs no cryptography itself; it only shuttles the
 * already-encrypted storage shapes to/from Firestore.
 */

interface UserDocData {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  createdAt?: Timestamp;
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

/** Initial key issuance (ARCHITECTURE.md §3.1 step 4-5, Phase 4 onboarding). Doc must not already exist. */
export async function createUserKeyRecord(
  uid: string,
  publicKeys: HybridPublicKeysRaw,
  wrappedSeed: WrappedSeed
): Promise<void> {
  await setDoc(doc(db, "users", uid), {
    publicKeys: publicKeysToStorage(publicKeys),
    wrappedSeed: wrappedSeedToStorage(wrappedSeed),
    createdAt: serverTimestamp(),
  });
}

/** Passphrase change (Phase 4, ARCHITECTURE.md §3.6 rule 5): only the wrapped seed changes. */
export async function updateWrappedSeed(uid: string, wrappedSeed: WrappedSeed): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    wrappedSeed: wrappedSeedToStorage(wrappedSeed),
  });
}

/**
 * "초기화" (Phase 4, ARCHITECTURE.md §3.6 rule 5): a brand new seed replaces
 * the old one, so publicKeys change too. `createdAt` is deliberately left
 * untouched (not included in this update) — firestore.rules' isKeyRotationRequest()
 * requires it stay equal to the existing value, matching the original
 * account creation time rather than the reset time.
 */
export async function resetUserKeyRecord(
  uid: string,
  publicKeys: HybridPublicKeysRaw,
  wrappedSeed: WrappedSeed
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    publicKeys: publicKeysToStorage(publicKeys),
    wrappedSeed: wrappedSeedToStorage(wrappedSeed),
  });
}
