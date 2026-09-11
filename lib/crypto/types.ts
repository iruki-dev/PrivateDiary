/** In-memory (raw byte) types used by lib/crypto's core functions. */

export interface HybridPublicKeysRaw {
  x25519PublicKey: Uint8Array;
  mlkem768PublicKey: Uint8Array;
}

/**
 * Never persisted (ARCHITECTURE.md rule 6) — always re-derived from the master
 * seed for the lifetime of an unlocked session, then wiped.
 */
export interface HybridPrivateKeys {
  x25519SecretKey: Uint8Array;
  mlkem768SecretKey: Uint8Array;
}

export interface HybridKeyPair {
  publicKeys: HybridPublicKeysRaw;
  privateKeys: HybridPrivateKeys;
}

export interface WrappedSeed {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  kdf: "pbkdf2";
  kdfParams: { iterations: number; hash: "SHA-256" };
}

/**
 * Authenticated (but not secret) metadata bound to an entry's ciphertext via
 * AES-GCM AAD, to detect rollback/substitution (ARCHITECTURE.md §3.4).
 */
export interface EntryAAD {
  uid: string;
  entrySeq: number;
  createdAt: string;
}

export interface EncryptedEntryPayload {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrappedContentKey: Uint8Array;
  wrappedContentKeyIv: Uint8Array;
  kemCiphertext: Uint8Array;
  ephemeralX25519PublicKey: Uint8Array;
  aad: EntryAAD;
}

/** JSON-serializable (base64) mirrors of the above, for Firestore storage. */

export interface HybridPublicKeysStorage {
  x25519: { kty: "OKP"; crv: "X25519"; x: string };
  mlkem768: string;
}

export interface WrappedSeedStorage {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: "pbkdf2";
  kdfParams: { iterations: number; hash: "SHA-256" };
}

export interface EncryptedEntryStorage {
  ciphertext: string;
  iv: string;
  wrappedContentKey: string;
  wrappedContentKeyIv: string;
  kemCiphertext: string;
  ephemeralX25519PublicKey: string;
  aad: EntryAAD;
}

/**
 * Additional, independently-toggleable ways to decrypt the diary besides
 * the passphrase (which is always active — there is no "disable the
 * passphrase" option, since losing every configured method would mean
 * permanent, unrecoverable data loss with nothing left to fall back to).
 * Either, both, or neither can be enabled at once — they're OR'd together,
 * not a single exclusive choice: any ONE of the active methods is enough
 * to decrypt. The seed itself is never stored unwrapped — "recovery key"
 * wraps it with a random 256-bit key the user holds offline; "shamir"
 * splits the seed directly into N shares (K needed to reconstruct) that
 * are never stored anywhere at all, only shown once.
 */
export interface DecryptionMethodsConfig {
  recoveryKeyEnabled: boolean;
  shamir: { n: number; k: number } | null;
}

export interface RecoveryKeyWrappedSeed {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

export interface RecoveryKeyWrappedSeedStorage {
  ciphertext: string;
  iv: string;
}
