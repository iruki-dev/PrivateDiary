import type { ENTRY_FORMAT_PADDED } from "./constants";

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
  /**
   * Plaintext record format (ARCHITECTURE.md §3.15). Present and equal to
   * ENTRY_FORMAT_PADDED on everything this code writes; absent only on
   * entries written before length padding existed, which are read back as
   * raw UTF-8.
   *
   * This belongs in the AAD, not in a plain document field, precisely
   * because the AAD is authenticated: an attacker who strips it to make a
   * padded entry decode as raw text changes the AAD bytes, and the GCM tag
   * check fails. A bare field would let the same downgrade happen
   * silently.
   */
  fmt?: typeof ENTRY_FORMAT_PADDED;
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

export interface ShamirWrappedSeedStorage {
  ciphertext: string;
  iv: string;
}

/**
 * Shamir's Secret Sharing: the sole alternative to the passphrase (opt-in).
 * Passphrase and Shamir are symmetric, mutually-trusting credentials over
 * the account — either decrypts the diary, resets the passphrase, and
 * reissues Shamir shares, without either one revealing the other's actual
 * value (see lib/crypto/recovery.ts). There is no "disable the passphrase"
 * option: it's always active, since losing every configured credential
 * would mean permanent, unrecoverable data loss with nothing left to fall
 * back to. The shares themselves are never stored anywhere — only the
 * (n, k) shape is, so this config is either null (off) or the shape.
 */
export interface DecryptionMethodsConfig {
  shamir: { n: number; k: number } | null;
}

/**
 * The master seed, AES-GCM-wrapped under a random key that Shamir shares
 * split (lib/crypto/recovery.ts) — NOT the seed split directly. This is
 * what makes reissuing shares actually invalidate the old ones: reissue
 * generates a fresh wrap key and REPLACES this ciphertext, so old shares
 * reconstruct a wrap key that can no longer decrypt anything stored.
 */
export interface ShamirWrappedSeed {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}
