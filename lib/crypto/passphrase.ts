import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import {
  AES_GCM_IV_LENGTH,
  MASTER_SEED_LENGTH,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT_LENGTH,
} from "./constants";
import { WrongPassphraseError } from "./errors";
import { wipeBytes } from "./memory";
import type { WrappedSeed } from "./types";

async function derivePbkdf2WrappingKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    utf8ToBytes(passphrase) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

/**
 * Wraps the master seed with a passphrase-derived AES-256 key
 * (ARCHITECTURE.md §3.1 step 5, §3.6). Salt is fresh random bytes every call
 * — never derived from uid or any predictable value (§3.6 rule 4).
 */
export async function wrapSeed(
  masterSeed: Uint8Array,
  passphrase: string
): Promise<WrappedSeed> {
  if (masterSeed.length !== MASTER_SEED_LENGTH) {
    throw new Error(`masterSeed must be ${MASTER_SEED_LENGTH} bytes`);
  }
  const salt = randomBytes(PBKDF2_SALT_LENGTH);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const wrappingKey = await derivePbkdf2WrappingKey(passphrase, salt, PBKDF2_ITERATIONS);

  const ciphertext = await aesGcmEncrypt(wrappingKey, iv, masterSeed);
  wipeBytes(wrappingKey);

  return {
    ciphertext,
    iv,
    salt,
    kdf: "pbkdf2",
    kdfParams: { iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
  };
}

/**
 * Recovers the master seed from a wrapped blob + passphrase. There is no
 * server-side "is this passphrase correct" check anywhere in this codebase
 * (§3.6 rule 1) — AES-GCM auth-tag failure on decrypt IS the wrong-passphrase
 * signal, translated here into WrongPassphraseError.
 */
export async function unwrapSeed(
  wrapped: WrappedSeed,
  passphrase: string
): Promise<Uint8Array> {
  const wrappingKey = await derivePbkdf2WrappingKey(
    passphrase,
    wrapped.salt,
    wrapped.kdfParams.iterations
  );
  try {
    const seed = await aesGcmDecrypt(wrappingKey, wrapped.iv, wrapped.ciphertext);
    wipeBytes(wrappingKey);
    return seed;
  } catch {
    wipeBytes(wrappingKey);
    throw new WrongPassphraseError();
  }
}

/**
 * Passphrase change, not recovery (ARCHITECTURE.md §3.6 rule 5): requires the
 * correct existing passphrase to unwrap, then re-wraps under the new one.
 * Throws WrongPassphraseError if `oldPassphrase` is wrong — nothing is
 * changed in that case.
 */
export async function rewrapSeed(
  wrapped: WrappedSeed,
  oldPassphrase: string,
  newPassphrase: string
): Promise<WrappedSeed> {
  const seed = await unwrapSeed(wrapped, oldPassphrase);
  const rewrapped = await wrapSeed(seed, newPassphrase);
  wipeBytes(seed);
  return rewrapped;
}
