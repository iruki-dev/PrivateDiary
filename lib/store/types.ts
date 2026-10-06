/**
 * One shape for "where this diary lives", so the screens and contexts
 * don't care whether it is an account on the server, a diary kept only on
 * this phone, or the phone's own copy of an account's diary:
 *
 *   - "cloud"  — users/{uid} + entries in Firestore (lib/store/cloud.ts).
 *   - "local"  — the Android app's fully local diary: nothing ever leaves
 *                the phone (lib/store/local.ts).
 *   - "backup" — the Android app's on-phone copy of a cloud account's
 *                diary, opened read-only when the server can't be reached
 *                (lib/store/backup.ts).
 *
 * Every store holds exactly what the server always held: public keys, the
 * passphrase-wrapped seed, the backup-code-wrapped seed and encrypted
 * entries. None of them stores a passphrase, a seed or plaintext — the
 * same crypto (lib/crypto) runs on top of all three, so a diary opens the
 * same way wherever it lives.
 *
 * This module has no Firebase or IndexedDB imports; it is only types.
 */
import type {
  DecryptionMethodsConfig,
  EncryptedEntryPayload,
  HybridPublicKeysRaw,
  ShamirWrappedSeed,
  WrappedSeed,
} from "@/lib/crypto";
import type { UserPreferences } from "@/lib/preferences";

/** What a stored entry's time looks like: a Firestore Timestamp, or a local stand-in with the same method. */
export interface EntryTimestamp {
  toDate(): Date;
}

export interface StoredEntryMetadata {
  id: string;
  /** Who the entry belongs to — bound into its AAD (EntryAAD.uid). */
  uid: string;
  entrySeq: number;
  /** null only for a cloud entry whose serverTimestamp() hasn't resolved yet. */
  createdAt: EntryTimestamp | null;
}

export interface StoredEntry extends StoredEntryMetadata {
  /**
   * security-patch-v2 / H2: null means this document exists (its
   * uid/entrySeq/createdAt are real and counted for integrity purposes)
   * but its stored base64 fields couldn't be decoded — see
   * lib/firebase/entries.ts's listEntries(). Distinct from a decryption
   * failure (TamperedCiphertextError), which only ever happens for a
   * payload that DID decode.
   */
  payload: EncryptedEntryPayload | null;
}

/** Sequence-level integrity of a fetched list — see lib/firebase/entrySequence.ts. */
export interface EntrySequenceIntegrity {
  ok: boolean;
  missingSeqs: number[];
  duplicateSeqs: number[];
  missingTailCount: number;
}

export interface EntryList {
  entries: StoredEntry[];
  integrity: EntrySequenceIntegrity;
}

export interface UserKeyRecord {
  publicKeys: HybridPublicKeysRaw;
  wrappedSeed: WrappedSeed;
  decryptionMethods: DecryptionMethodsConfig;
  /** The Shamir wrap-key indirection (lib/crypto/recovery.ts) — null unless Shamir is configured. */
  shamirWrappedSeed: ShamirWrappedSeed | null;
}

export interface WriteEntryOptions {
  /**
   * When the entry was written. Only set when bringing entries in from an
   * export file (lib/entries/import.ts), so an imported entry keeps its own
   * day on the calendar; a new entry always takes "now".
   */
  createdAt?: Date;
}

export type DiaryStoreKind = "cloud" | "local" | "backup";

export interface DiaryStore {
  readonly kind: DiaryStoreKind;
  /** Bound into every entry's AAD as `uid`: the Firebase uid, or the local diary's id. */
  readonly ownerId: string;
  /** The on-phone copy of a cloud diary only reads; everything that writes throws ReadOnlyStoreError. */
  readonly readOnly: boolean;

  /** null until the diary's keys have been created (onboarding not finished). */
  getKeyRecord(): Promise<UserKeyRecord | null>;
  createKeyRecord(publicKeys: HybridPublicKeysRaw, wrappedSeed: WrappedSeed): Promise<void>;
  updateWrappedSeed(wrappedSeed: WrappedSeed): Promise<void>;
  setShamir(n: number, k: number, wrappedSeed: ShamirWrappedSeed, otpBypassVerifier: Uint8Array): Promise<void>;
  disableShamir(): Promise<void>;

  getPreferences(): Promise<UserPreferences>;
  setPreferences(patch: Partial<UserPreferences>): Promise<void>;

  listEntries(): Promise<EntryList>;
  /** Encrypts and stores one entry with only the public keys (works while locked). Returns its id. */
  writeEntry(publicKeys: HybridPublicKeysRaw, plaintext: string, options?: WriteEntryOptions): Promise<string>;

  /** The name the diary greets its owner with; null when none was chosen. */
  getNickname(): Promise<string | null>;
  setNickname(nickname: string): Promise<void>;
}

export class ReadOnlyStoreError extends Error {
  constructor() {
    super("This copy of the diary can only be read.");
    this.name = "ReadOnlyStoreError";
  }
}
