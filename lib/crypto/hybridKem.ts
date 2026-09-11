import { x25519 } from "@noble/curves/ed25519.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import { AES_GCM_IV_LENGTH, CONTENT_KEY_WRAP_INFO } from "./constants";
import { TamperedCiphertextError } from "./errors";
import { wipeBytes } from "./memory";
import type { HybridPrivateKeys, HybridPublicKeysRaw } from "./types";

export interface ContentKeyCapsule {
  wrappedContentKey: Uint8Array;
  wrappedContentKeyIv: Uint8Array;
  kemCiphertext: Uint8Array;
  ephemeralX25519PublicKey: Uint8Array;
}

/**
 * Combines the classical (X25519 ECDH) and post-quantum (ML-KEM-768) shared
 * secrets into one AES key via HKDF (ARCHITECTURE.md §3.2 step 2c). The
 * ephemeral X25519 public key — already unique per call since a fresh
 * ephemeral key pair is generated every encapsulation, and already
 * transmitted/stored alongside the ciphertext — doubles as the HKDF salt, so
 * no separate per-entry identifier needs to be threaded through this
 * function's two-argument public API.
 */
async function deriveWrappingKey(
  sharedSecretClassical: Uint8Array,
  sharedSecretPQ: Uint8Array,
  salt: Uint8Array
): Promise<Uint8Array> {
  const ikm = concatBytes(sharedSecretClassical, sharedSecretPQ);
  const wrappingKey = hkdf(sha256, ikm, salt, utf8ToBytes(CONTENT_KEY_WRAP_INFO), 32);
  wipeBytes(ikm);
  return wrappingKey;
}

/**
 * Hybrid-encapsulates a content key for a recipient (ARCHITECTURE.md §3.2
 * step 2). Safe as long as EITHER X25519 OR ML-KEM-768 remains unbroken —
 * that's the whole point of running both.
 */
export async function encapsulateContentKey(
  recipientPublicKeys: HybridPublicKeysRaw,
  contentKey: Uint8Array
): Promise<ContentKeyCapsule> {
  const ephemeral = x25519.keygen();
  const sharedSecretClassical = x25519.getSharedSecret(
    ephemeral.secretKey,
    recipientPublicKeys.x25519PublicKey
  );
  const { cipherText: kemCiphertext, sharedSecret: sharedSecretPQ } = ml_kem768.encapsulate(
    recipientPublicKeys.mlkem768PublicKey
  );

  const wrappingKey = await deriveWrappingKey(
    sharedSecretClassical,
    sharedSecretPQ,
    ephemeral.publicKey
  );
  const wrappedContentKeyIv = randomBytes(AES_GCM_IV_LENGTH);
  const wrappedContentKey = await aesGcmEncrypt(wrappingKey, wrappedContentKeyIv, contentKey);

  wipeBytes(ephemeral.secretKey, sharedSecretClassical, sharedSecretPQ, wrappingKey);

  return {
    wrappedContentKey,
    wrappedContentKeyIv,
    kemCiphertext,
    ephemeralX25519PublicKey: ephemeral.publicKey,
  };
}

/**
 * Reverses encapsulateContentKey (ARCHITECTURE.md §3.3 step 3). A tampered
 * `kemCiphertext` or `ephemeralX25519PublicKey` never throws inside the KEM
 * itself (ML-KEM's decapsulate is implicit-reject-only per FIPS-203) — it
 * silently yields a different shared secret, so the wrapping key is wrong,
 * and the AES-GCM tag check below is what actually surfaces the tamper as an
 * error (ARCHITECTURE.md §3.4).
 */
export async function decapsulateContentKey(
  privateKeys: HybridPrivateKeys,
  capsule: ContentKeyCapsule
): Promise<Uint8Array> {
  try {
    const sharedSecretClassical = x25519.getSharedSecret(
      privateKeys.x25519SecretKey,
      capsule.ephemeralX25519PublicKey
    );
    const sharedSecretPQ = ml_kem768.decapsulate(
      capsule.kemCiphertext,
      privateKeys.mlkem768SecretKey
    );

    const wrappingKey = await deriveWrappingKey(
      sharedSecretClassical,
      sharedSecretPQ,
      capsule.ephemeralX25519PublicKey
    );
    wipeBytes(sharedSecretClassical, sharedSecretPQ);

    const contentKey = await aesGcmDecrypt(
      wrappingKey,
      capsule.wrappedContentKeyIv,
      capsule.wrappedContentKey
    );
    wipeBytes(wrappingKey);
    return contentKey;
  } catch {
    throw new TamperedCiphertextError();
  }
}
