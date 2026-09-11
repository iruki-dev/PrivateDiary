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
  recoveryKeyWrappedSeedFromStorage,
  recoveryKeyWrappedSeedToStorage,
  wrappedSeedFromStorage,
  wrappedSeedToStorage,
  type DecryptionMethodsConfig,
  type HybridPublicKeysRaw,
  type HybridPublicKeysStorage,
  type RecoveryKeyWrappedSeed,
  type RecoveryKeyWrappedSeedStorage,
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
  recoveryKey?: { wrappedSeed: RecoveryKeyWrappedSeedStorage };
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
  /** Only present when decryptionMethods.recoveryKeyEnabled is true. */
  recoveryWrappedSeed: RecoveryKeyWrappedSeed | null;
}

function parseDecryptionMethods(data: DecryptionMethodsDocData | undefined): {
  decryptionMethods: DecryptionMethodsConfig;
  recoveryWrappedSeed: RecoveryKeyWrappedSeed | null;
} {
  return {
    decryptionMethods: {
      recoveryKeyEnabled: data?.recoveryKey != null,
      shamir: data?.shamir ? { n: data.shamir.n, k: data.shamir.k } : null,
    },
    recoveryWrappedSeed: data?.recoveryKey
      ? recoveryKeyWrappedSeedFromStorage(data.recoveryKey.wrappedSeed)
      : null,
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
    ...parseDecryptionMethods(data.decryptionMethods),
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
 *
 * Every configured decryption method is cleared: a recovery key or Shamir
 * share set up against the OLD seed can no longer reconstruct anything
 * meaningful once the seed changes, so leaving them configured would just
 * be a stale, misleading UI state.
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

/** Enables recovery-key decryption, leaving Shamir (if enabled) untouched. */
export async function enableRecoveryKeyMethod(
  uid: string,
  wrapped: RecoveryKeyWrappedSeed
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.recoveryKey": { wrappedSeed: recoveryKeyWrappedSeedToStorage(wrapped) },
  });
}

/** Disables recovery-key decryption, leaving Shamir (if enabled) untouched. */
export async function disableRecoveryKeyMethod(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.recoveryKey": deleteField(),
  });
}

/** Enables Shamir-split decryption, leaving the recovery key (if enabled) untouched. No share material is stored — only the (n, k) shape. */
export async function enableShamirMethod(uid: string, n: number, k: number): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.shamir": { n, k },
  });
}

/** Disables Shamir-split decryption, leaving the recovery key (if enabled) untouched. */
export async function disableShamirMethod(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.shamir": deleteField(),
  });
}
