import { combine, split } from "shamir-secret-sharing";
import { randomBytes } from "@noble/hashes/utils.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import { AES_GCM_IV_LENGTH, MASTER_SEED_LENGTH } from "./constants";
import { InvalidRecoveryKeyError, InvalidShamirSharesError } from "./errors";
import { deriveHybridKeyPair } from "./keys";
import { wipeBytes } from "./memory";
import type { HybridPublicKeysRaw, RecoveryKeyWrappedSeed } from "./types";

/**
 * Opt-in secondary recovery paths for the master seed, replacing the BIP39
 * mnemonic. Two independent mechanisms, both entirely separate from the
 * passphrase (rule 5: login/passphrase and encryption keys never mix):
 *
 * - Recovery key: a random 256-bit key wraps the seed (AES-GCM) into a blob
 *   Firestore can safely hold, because without the key — which is shown
 *   exactly once and never stored anywhere — it's just ciphertext.
 * - Shamir: the seed itself is split into N shares (K needed to
 *   reconstruct). Nothing about the shares is ever stored server-side; a
 *   single leaked share reveals nothing (below threshold, shares are
 *   information-theoretically independent of the secret).
 *
 * Both require proving current possession before they can be changed or
 * removed — see contexts/SeedContext.tsx's stage/commit flow.
 */

export const RECOVERY_KEY_LENGTH = 32;

export function generateRecoveryKey(): Uint8Array {
  return randomBytes(RECOVERY_KEY_LENGTH);
}

export async function wrapSeedWithRecoveryKey(
  masterSeed: Uint8Array,
  recoveryKey: Uint8Array
): Promise<RecoveryKeyWrappedSeed> {
  if (masterSeed.length !== MASTER_SEED_LENGTH) {
    throw new Error(`masterSeed must be ${MASTER_SEED_LENGTH} bytes`);
  }
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const ciphertext = await aesGcmEncrypt(recoveryKey, iv, masterSeed);
  return { ciphertext, iv };
}

export async function unwrapSeedWithRecoveryKey(
  wrapped: RecoveryKeyWrappedSeed,
  recoveryKey: Uint8Array
): Promise<Uint8Array> {
  try {
    return await aesGcmDecrypt(recoveryKey, wrapped.iv, wrapped.ciphertext);
  } catch {
    throw new InvalidRecoveryKeyError();
  }
}

/**
 * Splits the master seed into `n` Shamir shares, `k` of which reconstruct
 * it. Each returned share is 33 bytes (32-byte seed + 1-byte share index —
 * see shamir-secret-sharing's GF(2^8) encoding).
 */
export async function splitSeedShamir(
  masterSeed: Uint8Array,
  n: number,
  k: number
): Promise<Uint8Array[]> {
  if (masterSeed.length !== MASTER_SEED_LENGTH) {
    throw new Error(`masterSeed must be ${MASTER_SEED_LENGTH} bytes`);
  }
  return split(masterSeed, n, k);
}

/**
 * Reconstructs a candidate seed from Shamir shares. shamir-secret-sharing's
 * combine() does NOT validate its input (by design, per its own docs) —
 * wrong, insufficient, or corrupted shares silently produce 32 bytes of
 * garbage instead of throwing. Callers MUST verify the result with
 * seedMatchesPublicKeys() before trusting it; this function only checks the
 * output has the right length as a cheap sanity filter.
 */
export async function combineSeedShamir(shares: Uint8Array[]): Promise<Uint8Array> {
  const combined = await combine(shares);
  if (combined.length !== MASTER_SEED_LENGTH) {
    wipeBytes(combined);
    throw new InvalidShamirSharesError();
  }
  return combined;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * The actual integrity check for any reconstructed-from-proof seed
 * (recovery key OR Shamir shares): re-derive the public key pair and
 * compare against what's already on record in Firestore. Cheap, exact, and
 * needs no extra stored verifier data — deriveHybridKeyPair() is
 * deterministic, so a wrong seed provably yields different public keys.
 */
export function seedMatchesPublicKeys(
  candidateSeed: Uint8Array,
  expectedPublicKeys: HybridPublicKeysRaw
): boolean {
  const derived = deriveHybridKeyPair(candidateSeed);
  const matches =
    bytesEqual(derived.publicKeys.x25519PublicKey, expectedPublicKeys.x25519PublicKey) &&
    bytesEqual(derived.publicKeys.mlkem768PublicKey, expectedPublicKeys.mlkem768PublicKey);
  wipeBytes(derived.privateKeys.x25519SecretKey, derived.privateKeys.mlkem768SecretKey);
  return matches;
}
