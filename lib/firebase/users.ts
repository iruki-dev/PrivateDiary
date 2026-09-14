import { FirebaseError } from "firebase/app";
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
import { ReauthRequiredError } from "./reauth";
import {
  DISPLAY_PREFERENCE_KEYS,
  SECURITY_PREFERENCE_KEYS,
  normalizePreferences,
  type UserPreferences,
} from "@/lib/preferences";
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
 * Account-level preferences. The shape, defaults and validation live in
 * lib/preferences.ts (no Firebase import, so firestore.rules has one
 * auditable counterpart and the rules can be mirrored in unit tests);
 * re-exported here because this is where callers already import them from.
 */
export type { UserPreferences } from "@/lib/preferences";

interface UserDocData {
  publicKeys: HybridPublicKeysStorage;
  wrappedSeed: WrappedSeedStorage;
  decryptionMethods?: DecryptionMethodsDocData;
  /** Cosmetic-only fields (lib/preferences.ts's DISPLAY_PREFERENCE_KEYS) — no reauth to write. */
  preferences?: Partial<Pick<UserPreferences, (typeof DISPLAY_PREFERENCE_KEYS)[number]>>;
  /**
   * Exposure-relevant fields (lib/preferences.ts's SECURITY_PREFERENCE_KEYS)
   * — a separate top-level field from `preferences` specifically so
   * firestore.rules can gate it like a credential-bearing field
   * (credentialMutationAllowed()) while `preferences` stays ungated. See
   * lib/preferences.ts's module doc for the full reasoning.
   */
  security?: Partial<Pick<UserPreferences, (typeof SECURITY_PREFERENCE_KEYS)[number]>>;
  /**
   * Highest entrySeq handed out so far (ARCHITECTURE.md §3.4). Lives here
   * rather than being recomputed from the `entries` collection because
   * writing an entry must keep working without any unlock step (§3.2 rule
   * 5) while `entries` READS are behind the OTP gate — deriving the next
   * sequence number by querying entries made every write depend on a gate
   * that is deliberately read-only. firestore.rules' isOtpUngatedChange()
   * lets this field (and `preferences`) move without either
   * otpSatisfied() or isRecentAuth(), and forces it forward-only so a
   * stale client can't reissue a number already used.
   *
   * Optional: accounts created before this field existed don't have it —
   * see lib/firebase/entries.ts's getNextEntrySeq fallback.
   */
  lastEntrySeq?: number;
  createdAt?: Timestamp;
}

export interface UserKeyRecord {
  publicKeys: HybridPublicKeysRaw;
  wrappedSeed: WrappedSeed;
  decryptionMethods: DecryptionMethodsConfig;
  /** The Shamir wrap-key indirection (lib/crypto/recovery.ts) — null unless Shamir is configured. */
  shamirWrappedSeed: ShamirWrappedSeed | null;
}

/** Reads the entry-sequence counter. `null` for accounts predating the field. */
export async function getLastEntrySeq(uid: string): Promise<number | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  const stored = (snapshot.data() as UserDocData | undefined)?.lastEntrySeq;
  return typeof stored === "number" ? stored : null;
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
 * security-patch-v2 / C1: wraps every write that changes a credential-
 * bearing field (wrappedSeed, publicKeys, decryptionMethods.shamir) —
 * everything firestore.rules' isKeyRotationRequest() covers except the
 * ungated preferences/lastEntrySeq path. firestore.rules now requires
 * isRecentAuth() for these on accounts without OTP enabled (OTP-enabled
 * accounts keep today's otpSatisfied() gate, unchanged) — this is what the
 * caller (SeedContext / app/settings/page.tsx) actually sees when that
 * check fails: a plain Firestore `permission-denied`, indistinguishable
 * from any other rules rejection unless translated here into
 * ReauthRequiredError so the UI knows to prompt reauthentication rather
 * than show a generic failure. Safe to translate unconditionally: by the
 * time one of these functions is called, the caller has already locally
 * proven the passphrase or Shamir shares and shaped a document that passes
 * isValidUserDoc()/isKeyRotationRequest() — the only rule left that can
 * still reject it is the recent-auth requirement.
 */
async function runCredentialMutation(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "permission-denied") {
      throw new ReauthRequiredError();
    }
    throw err;
  }
}

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
    lastEntrySeq: 0,
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
  await runCredentialMutation(() =>
    updateDoc(doc(db, "users", uid), {
      wrappedSeed: wrappedSeedToStorage(wrappedSeed),
      ...legacyRecoveryKeyCleanup,
    })
  );
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
  await runCredentialMutation(() =>
    updateDoc(doc(db, "users", uid), {
      publicKeys: publicKeysToStorage(publicKeys),
      wrappedSeed: wrappedSeedToStorage(wrappedSeed),
      decryptionMethods: {},
    })
  );
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
  await runCredentialMutation(() =>
    updateDoc(doc(db, "users", uid), {
      "decryptionMethods.shamir": {
        n,
        k,
        wrappedSeed: shamirWrappedSeedToStorage(wrappedSeed),
        otpBypassVerifier: bytesToBase64(otpBypassVerifier),
      },
      ...legacyRecoveryKeyCleanup,
    })
  );
}

/** Turns Shamir off entirely. */
export async function disableShamirMethod(uid: string): Promise<void> {
  await runCredentialMutation(() =>
    updateDoc(doc(db, "users", uid), {
      "decryptionMethods.shamir": deleteField(),
      ...legacyRecoveryKeyCleanup,
    })
  );
}

/**
 * Missing or invalid fields fall back to their default — covers accounts
 * that never set a given preference, and refuses to trust a stored value
 * outside what the UI can produce (see normalizePreferences). Reads both
 * `preferences` and `security` and merges them into one object; callers
 * don't need to know they're stored separately.
 */
export async function getUserPreferences(uid: string): Promise<UserPreferences> {
  const snapshot = await getDoc(doc(db, "users", uid));
  const data = snapshot.data() as UserDocData | undefined;
  return normalizePreferences({ ...data?.preferences, ...data?.security });
}

function isSecurityPreferenceKey(key: string): key is (typeof SECURITY_PREFERENCE_KEYS)[number] {
  return (SECURITY_PREFERENCE_KEYS as readonly string[]).includes(key);
}

/**
 * Merges `patch` into the account's preferences, split across the two
 * Firestore fields by key (lib/preferences.ts's DISPLAY_PREFERENCE_KEYS /
 * SECURITY_PREFERENCE_KEYS) so each half gets the write path its own
 * field's firestore.rules gate needs:
 *
 *   - Display keys (privateWritingMode, privateWritingPeekAllowed) write
 *     straight to `preferences.*` — no reauth, same as always.
 *   - Security keys (autoLockMinutes, draftAutosave) write to `security.*`
 *     through runCredentialMutation(), so a stale non-OTP session gets
 *     ReauthRequiredError instead of a bare permission-denied — see that
 *     function's doc comment.
 *
 * In practice the UI only ever sends one key at a time (each toggle/select
 * in /settings calls this with a single-key patch), but a mixed patch is
 * handled correctly: each half only fires if the patch actually touches
 * that field, and a security-key failure doesn't roll back an
 * already-applied display-key write — Firestore has no cross-document
 * transaction here to make that atomic anyway, and the two fields have no
 * consistency requirement between them.
 */
export async function setUserPreferences(uid: string, patch: Partial<UserPreferences>): Promise<void> {
  const displayPatch: Record<string, unknown> = {};
  const securityPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isSecurityPreferenceKey(key)) {
      securityPatch[`security.${key}`] = value;
    } else {
      displayPatch[`preferences.${key}`] = value;
    }
  }

  const writes: Promise<void>[] = [];
  if (Object.keys(displayPatch).length > 0) {
    writes.push(updateDoc(doc(db, "users", uid), displayPatch));
  }
  if (Object.keys(securityPatch).length > 0) {
    writes.push(runCredentialMutation(() => updateDoc(doc(db, "users", uid), securityPatch)));
  }
  await Promise.all(writes);
}
