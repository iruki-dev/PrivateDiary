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
  bytesToBase64,
  publicKeysFromStorage,
  publicKeysToStorage,
  shamirWrappedSeedFromStorage,
  shamirWrappedSeedToStorage,
  wrappedSeedFromStorage,
  wrappedSeedToStorage,
  type DecryptionMethodsConfig,
  type HybridPublicKeysRaw,
  type HybridPublicKeysStorage,
  type ShamirWrappedSeed,
  type ShamirWrappedSeedStorage,
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
  shamir?: {
    n: number;
    k: number;
    wrappedSeed: ShamirWrappedSeedStorage;
    /**
     * base64 — see lib/crypto/recovery.ts and functions/src/index.ts's
     * verifyShamirOtpBypass. Optional because accounts that set up Shamir
     * between the wrap-key fix and this field's introduction have a valid
     * `wrappedSeed` but no verifier yet; the client never reads this value
     * (only the Cloud Function does, server-side), so a missing verifier
     * doesn't affect decrypt/reissue at all — the user just needs to
     * reissue once to also get working OTP-bypass.
     */
    otpBypassVerifier?: string;
  };
}

/**
 * Pure display preferences (ARCHITECTURE.md §3.9) — never read by
 * lib/crypto or functions/, kept account-level (not localStorage) because
 * that's what was actually asked for: these should follow the user across
 * devices rather than being per-device.
 */
export interface UserPreferences {
  privateWritingMode: boolean;
  privateWritingPeekAllowed: boolean;
}

interface UserDocData {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  decryptionMethods?: DecryptionMethodsDocData;
  preferences?: Partial<UserPreferences>;
  createdAt?: Timestamp;
}

export interface UserKeyRecord {
  publicKeys: HybridPublicKeysRaw;
  wrappedSeed: WrappedSeed;
  decryptionMethods: DecryptionMethodsConfig;
  /** The Shamir wrap-key indirection (lib/crypto/recovery.ts) — null unless Shamir is configured. */
  shamirWrappedSeed: ShamirWrappedSeed | null;
}

/**
 * Migration shim (ARCHITECTURE.md §3.7 rev. 3): accounts that enabled the
 * now-removed recovery key before this round would still have a
 * `decryptionMethods.recoveryKey` field sitting in Firestore. Rules
 * validate the FULL merged document on every write, and the current rules
 * only allow `decryptionMethods.keys().hasOnly(['shamir'])` — so leaving
 * that field in place would make every subsequent write to the doc
 * (passphrase change, Shamir setup, etc.) fail with permission-denied.
 * Spreading this into every users/{uid} update that doesn't already
 * overwrite `decryptionMethods` wholesale clears it out opportunistically;
 * deleteField() on an absent key is a harmless no-op.
 */
const legacyRecoveryKeyCleanup = { "decryptionMethods.recoveryKey": deleteField() };

/**
 * Migration shim (ARCHITECTURE.md §3.7 rev. 4): before this revision, Shamir
 * split the master seed directly and Firestore stored only `{ n, k }` — no
 * `wrappedSeed`. Any account that set up Shamir before this shipped still
 * has that old shape. Those old shares are unusable under the new
 * (wrap-key) scheme regardless — trying to parse a missing `wrappedSeed`
 * would otherwise throw and break `refresh()` entirely — so such a config
 * is treated as if Shamir were never set up, surfacing as "off" in the UI
 * rather than crashing. The user just needs to set it up again (via the
 * passphrase) to get a working, reissuable Shamir credential.
 */
function hasWrappedSeed(
  shamir: DecryptionMethodsDocData["shamir"]
): shamir is { n: number; k: number; wrappedSeed: ShamirWrappedSeedStorage } {
  return shamir != null && shamir.wrappedSeed != null;
}

function parseDecryptionMethods(
  data: DecryptionMethodsDocData | undefined
): DecryptionMethodsConfig {
  const shamir = data?.shamir;
  return {
    shamir: hasWrappedSeed(shamir) ? { n: shamir.n, k: shamir.k } : null,
  };
}

/** Returns null if the user hasn't completed key issuance yet (ARCHITECTURE.md §3.1). */
export async function getUserKeyRecord(uid: string): Promise<UserKeyRecord | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) {
    return null;
  }
  const data = snapshot.data() as UserDocData;
  const shamir = data.decryptionMethods?.shamir;
  return {
    publicKeys: publicKeysFromStorage(data.publicKeys),
    wrappedSeed: wrappedSeedFromStorage(data.wrappedSeed),
    decryptionMethods: parseDecryptionMethods(data.decryptionMethods),
    shamirWrappedSeed: hasWrappedSeed(shamir)
      ? shamirWrappedSeedFromStorage(shamir.wrappedSeed)
      : null,
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
    ...legacyRecoveryKeyCleanup,
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

/**
 * Sets up or reissues Shamir shares — the same write either way. Reissuing
 * overwrites `wrappedSeed` and `otpBypassVerifier` with freshly wrap-keyed
 * values (see lib/crypto/recovery.ts), which is what actually invalidates
 * whatever shares were issued before this call, for both decryption AND
 * OTP-bypass purposes — the shares and the wrap key itself are never
 * stored, only these derived values and the (n, k) shape.
 */
export async function setShamirMethod(
  uid: string,
  n: number,
  k: number,
  wrappedSeed: ShamirWrappedSeed,
  otpBypassVerifier: Uint8Array
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.shamir": {
      n,
      k,
      wrappedSeed: shamirWrappedSeedToStorage(wrappedSeed),
      otpBypassVerifier: bytesToBase64(otpBypassVerifier),
    },
    ...legacyRecoveryKeyCleanup,
  });
}

/** Turns Shamir off entirely. */
export async function disableShamirMethod(uid: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    "decryptionMethods.shamir": deleteField(),
    ...legacyRecoveryKeyCleanup,
  });
}

const DEFAULT_PREFERENCES: UserPreferences = {
  privateWritingMode: false,
  privateWritingPeekAllowed: true,
};

/** Missing fields fall back to their default — covers accounts that never set a given preference yet. */
export async function getUserPreferences(uid: string): Promise<UserPreferences> {
  const snapshot = await getDoc(doc(db, "users", uid));
  const stored = (snapshot.data() as UserDocData | undefined)?.preferences;
  return { ...DEFAULT_PREFERENCES, ...stored };
}

/** Merges `patch` into `preferences` via dotted-path updates, leaving unrelated fields (and other preferences) untouched. */
export async function setUserPreferences(uid: string, patch: Partial<UserPreferences>): Promise<void> {
  const dottedPatch = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [`preferences.${key}`, value])
  );
  await updateDoc(doc(db, "users", uid), dottedPatch);
}
