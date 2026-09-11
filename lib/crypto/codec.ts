/**
 * Converts between lib/crypto's raw-byte types and the JSON-serializable
 * (base64) shape used for Firestore storage (ARCHITECTURE.md §4). Kept
 * inside lib/crypto — rather than in lib/firebase — so the storage encoding
 * of key/ciphertext material stays part of the audited crypto surface (rule
 * 3), even though these functions themselves do no cryptography.
 */
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url } from "./encoding";
import type {
  EncryptedEntryPayload,
  EncryptedEntryStorage,
  HybridPublicKeysRaw,
  HybridPublicKeysStorage,
  RecoveryKeyWrappedSeed,
  RecoveryKeyWrappedSeedStorage,
  WrappedSeed,
  WrappedSeedStorage,
} from "./types";

export function publicKeysToStorage(keys: HybridPublicKeysRaw): HybridPublicKeysStorage {
  return {
    x25519: { kty: "OKP", crv: "X25519", x: bytesToBase64Url(keys.x25519PublicKey) },
    mlkem768: bytesToBase64(keys.mlkem768PublicKey),
  };
}

export function publicKeysFromStorage(stored: HybridPublicKeysStorage): HybridPublicKeysRaw {
  return {
    x25519PublicKey: base64UrlToBytes(stored.x25519.x),
    mlkem768PublicKey: base64ToBytes(stored.mlkem768),
  };
}

export function wrappedSeedToStorage(wrapped: WrappedSeed): WrappedSeedStorage {
  return {
    ciphertext: bytesToBase64(wrapped.ciphertext),
    iv: bytesToBase64(wrapped.iv),
    salt: bytesToBase64(wrapped.salt),
    kdf: wrapped.kdf,
    kdfParams: wrapped.kdfParams,
  };
}

export function wrappedSeedFromStorage(stored: WrappedSeedStorage): WrappedSeed {
  return {
    ciphertext: base64ToBytes(stored.ciphertext),
    iv: base64ToBytes(stored.iv),
    salt: base64ToBytes(stored.salt),
    kdf: stored.kdf,
    kdfParams: stored.kdfParams,
  };
}

/** Text encoding for a recovery key or a single Shamir share, shown to / re-entered by the user. */
export function recoverySecretToText(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function textToRecoverySecret(text: string): Uint8Array {
  return base64ToBytes(text.trim());
}

export function recoveryKeyWrappedSeedToStorage(
  wrapped: RecoveryKeyWrappedSeed
): RecoveryKeyWrappedSeedStorage {
  return {
    ciphertext: bytesToBase64(wrapped.ciphertext),
    iv: bytesToBase64(wrapped.iv),
  };
}

export function recoveryKeyWrappedSeedFromStorage(
  stored: RecoveryKeyWrappedSeedStorage
): RecoveryKeyWrappedSeed {
  return {
    ciphertext: base64ToBytes(stored.ciphertext),
    iv: base64ToBytes(stored.iv),
  };
}

export function entryToStorage(entry: EncryptedEntryPayload): EncryptedEntryStorage {
  return {
    ciphertext: bytesToBase64(entry.ciphertext),
    iv: bytesToBase64(entry.iv),
    wrappedContentKey: bytesToBase64(entry.wrappedContentKey),
    wrappedContentKeyIv: bytesToBase64(entry.wrappedContentKeyIv),
    kemCiphertext: bytesToBase64(entry.kemCiphertext),
    ephemeralX25519PublicKey: bytesToBase64(entry.ephemeralX25519PublicKey),
    aad: entry.aad,
  };
}

export function entryFromStorage(stored: EncryptedEntryStorage): EncryptedEntryPayload {
  return {
    ciphertext: base64ToBytes(stored.ciphertext),
    iv: base64ToBytes(stored.iv),
    wrappedContentKey: base64ToBytes(stored.wrappedContentKey),
    wrappedContentKeyIv: base64ToBytes(stored.wrappedContentKeyIv),
    kemCiphertext: base64ToBytes(stored.kemCiphertext),
    ephemeralX25519PublicKey: base64ToBytes(stored.ephemeralX25519PublicKey),
    aad: stored.aad,
  };
}
