import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "./config";
import {
  publicKeysFromStorage,
  publicKeysToStorage,
  recoveryKeyWrappedSeedFromStorage,
  recoveryKeyWrappedSeedToStorage,
  wrappedSeedFromStorage,
  wrappedSeedToStorage,
  type HybridPublicKeysRaw,
  type HybridPublicKeysStorage,
  type RecoveryConfig,
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

type RecoveryDocData =
  | { type: "none" }
  | { type: "recovery-key"; wrappedSeed: RecoveryKeyWrappedSeedStorage }
  | { type: "shamir"; n: number; k: number };

interface UserDocData {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  recovery?: RecoveryDocData;
  createdAt?: Timestamp;
}

export interface UserKeyRecord {
  publicKeys: HybridPublicKeysRaw;
  wrappedSeed: WrappedSeed;
  recoveryConfig: RecoveryConfig;
  /** Only present when recoveryConfig.type === "recovery-key". */
  recoveryWrappedSeed: RecoveryKeyWrappedSeed | null;
}

function parseRecovery(recovery: RecoveryDocData | undefined): {
  recoveryConfig: RecoveryConfig;
  recoveryWrappedSeed: RecoveryKeyWrappedSeed | null;
} {
  if (!recovery || recovery.type === "none") {
    return { recoveryConfig: { type: "none" }, recoveryWrappedSeed: null };
  }
  if (recovery.type === "recovery-key") {
    return {
      recoveryConfig: { type: "recovery-key" },
      recoveryWrappedSeed: recoveryKeyWrappedSeedFromStorage(recovery.wrappedSeed),
    };
  }
  return {
    recoveryConfig: { type: "shamir", n: recovery.n, k: recovery.k },
    recoveryWrappedSeed: null,
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
    ...parseRecovery(data.recovery),
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
    recovery: { type: "none" },
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
 * Any existing recovery method is cleared back to "none": a recovery-key or
 * Shamir share set up against the OLD seed can no longer reconstruct
 * anything meaningful once the seed changes, so leaving it configured would
 * just be a stale, misleading UI state.
 */
export async function resetUserKeyRecord(
  uid: string,
  publicKeys: HybridPublicKeysRaw,
  wrappedSeed: WrappedSeed
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    publicKeys: publicKeysToStorage(publicKeys),
    wrappedSeed: wrappedSeedToStorage(wrappedSeed),
    recovery: { type: "none" },
  });
}

/** Sets up (or replaces) recovery-key-based recovery. */
export async function setUserRecoveryKey(
  uid: string,
  wrapped: RecoveryKeyWrappedSeed
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    recovery: { type: "recovery-key", wrappedSeed: recoveryKeyWrappedSeedToStorage(wrapped) },
  });
}

/** Sets up (or replaces) Shamir-split recovery. No share material is stored — only the (n, k) shape. */
export async function setUserShamirRecovery(uid: string, n: number, k: number): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    recovery: { type: "shamir", n, k },
  });
}

/** Removes whatever recovery method is currently configured. */
export async function clearUserRecovery(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    recovery: { type: "none" },
  });
}
