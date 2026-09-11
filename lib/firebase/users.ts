import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./config";
import {
  publicKeysFromStorage,
  publicKeysToStorage,
  wrappedSeedFromStorage,
  wrappedSeedToStorage,
  type DecryptionMethodsConfig,
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

interface DecryptionMethodsDocData {
  shamir?: { n: number; k: number };
}

interface UserDocData {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  decryptionMethods?: DecryptionMethodsDocData;
  createdAt?: Timestamp;
}

export interface UserKeyRecord {
  publicKeys: HybridPublicKeysRaw;
  wrappedSeed: WrappedSeed;
  decryptionMethods: DecryptionMethodsConfig;
}

function parseDecryptionMethods(
  data: DecryptionMethodsDocData | undefined
): DecryptionMethodsConfig {
  return {
    shamir: data?.shamir ? { n: data.shamir.n, k: data.shamir.k } : null,
  };
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
    decryptionMethods: parseDecryptionMethods(data.decryptionMethods),
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
    decryptionMethods: {},
    createdAt: serverTimestamp(),
  });
}

/**
 * Passphrase change (ARCHITECTURE.md §3.6 rule 5 / §3.7): only the wrapped
 * seed changes. Symmetric with Shamir — this is called whether the caller
 * proved the OLD passphrase (normal change) or Shamir shares (resetting a
 * forgotten passphrase); either way only the wrapping changes, never the
 * seed itself, so existing entries and any configured Shamir shares stay
 * valid.
 */
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
 *
 * Any configured Shamir shares are cleared: shares split against the OLD
 * seed can no longer reconstruct anything meaningful once the seed
 * changes. This is the true last resort — for a merely-forgotten
 * passphrase, prefer updateWrappedSeed() via Shamir proof instead, which
 * keeps the same seed (and thus every existing entry) intact.
 */
export async function resetUserKeyRecord(
  uid: string,
  publicKeys: HybridPublicKeysRaw,
  wrappedSeed: WrappedSeed
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    publicKeys: publicKeysToStorage(publicKeys),
    wrappedSeed: wrappedSeedToStorage(wrappedSeed),
    decryptionMethods: {},
  });
}

/** Sets up or reissues Shamir shares — the same write either way, since reissuing just overwrites the (n, k) shape (the shares themselves were never stored). */
export async function setShamirMethod(uid: string, n: number, k: number): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.shamir": { n, k },
  });
}

/** Turns Shamir off entirely. */
export async function disableShamirMethod(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.shamir": deleteField(),
  });
}
