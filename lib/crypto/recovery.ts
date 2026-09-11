import { combine, split } from "shamir-secret-sharing";
import { MASTER_SEED_LENGTH } from "./constants";
import { InvalidShamirSharesError } from "./errors";
import { deriveHybridKeyPair } from "./keys";
import { wipeBytes } from "./memory";
import type { HybridPublicKeysRaw } from "./types";

/**
 * Shamir's Secret Sharing, the sole alternative to the passphrase, replacing
 * the BIP39 mnemonic. The seed itself is split into N shares (K needed to
 * reconstruct); nothing about the shares is ever stored server-side — a
 * single leaked share reveals nothing (below threshold, shares are
 * information-theoretically independent of the secret).
 *
 * Passphrase and Shamir are deliberately symmetric, mutually-trusting
 * credentials over the account (see contexts/SeedContext.tsx): either one
 * decrypts the diary, resets the passphrase, and reissues Shamir shares —
 * without ever revealing the OTHER credential's actual value. That
 * non-revelation is a structural property, not something enforced by a
 * check anywhere: splitSeedShamir() draws fresh randomness every call (see
 * shamir-secret-sharing's own docs), so reissuing via the passphrase can
 * never reproduce a previously-issued set of shares even in principle, and
 * unwrapping the seed is one-directional — nothing recovers the passphrase
 * string from the seed it once unwrapped.
 */

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
 * The actual integrity check for a seed reconstructed from Shamir shares:
 * re-derive the public key pair and compare against what's already on
 * record in Firestore. Cheap, exact, and needs no extra stored verifier
 * data — deriveHybridKeyPair() is deterministic, so a wrong seed provably
 * yields different public keys.
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
