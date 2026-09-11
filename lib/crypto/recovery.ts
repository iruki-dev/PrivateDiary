import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { combine, split } from "shamir-secret-sharing";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import {
  AES_GCM_IV_LENGTH,
  SHAMIR_OTP_BYPASS_INFO,
  SHAMIR_OTP_BYPASS_VERIFIER_LENGTH,
  SHAMIR_WRAP_KEY_LENGTH,
} from "./constants";
import { InvalidShamirSharesError } from "./errors";
import { wipeBytes } from "./memory";
import type { ShamirWrappedSeed } from "./types";

/**
 * Shamir's Secret Sharing, the sole alternative to the passphrase, replacing
 * the BIP39 mnemonic. Shares split a random AES-256 KEY, NOT the master seed
 * itself — that key in turn AES-GCM-wraps the seed, in a `ShamirWrappedSeed`
 * blob stored in Firestore (mirroring how the passphrase wraps the seed via
 * `passphrase.ts`, rather than being derived into it).
 *
 * This indirection is what makes "reissue" an actual security operation
 * rather than a no-op: since Shamir's own combine() reconstructs whatever
 * secret was split with mathematical certainty regardless of how many times
 * you re-split it, splitting the SEED directly (an earlier version of this
 * file did exactly that) would mean old shares reconstruct the exact same
 * seed forever — reissuing never invalidates anything, because the thing
 * being reconstructed never changes. Splitting a wrap KEY instead means
 * reissuing can generate a fresh key, re-wrap the (unchanged) seed under it,
 * and overwrite the stored ciphertext — old shares still reconstruct the
 * OLD key, but that key can no longer decrypt anything, since the ciphertext
 * it could open no longer exists anywhere. The seed itself, and therefore
 * every entry encrypted to the keypair derived from it, is untouched by
 * this — only the Shamir wrapping layer rotates, exactly like a passphrase
 * change rotates only `wrappedSeed`, never the seed.
 *
 * Nothing about the shares or the wrap key is ever stored server-side — a
 * single leaked share reveals nothing (below threshold, shares are
 * information-theoretically independent of the secret), and the wrap key
 * itself never touches the network.
 *
 * Passphrase and Shamir are deliberately symmetric, mutually-trusting
 * credentials over the account (see contexts/SeedContext.tsx): either one
 * decrypts the diary, resets the passphrase, and reissues Shamir shares —
 * without ever revealing the OTHER credential's actual value. That
 * non-revelation is structural: the Shamir path only ever recovers the
 * seed (never the passphrase string, which isn't derived from or embedded
 * in the seed), and the passphrase path never touches the Shamir wrap key
 * or shares at all.
 *
 * The wrap key also backs the OTP-bypass mechanism (ARCHITECTURE.md §3.8):
 * `otpBypassVerifier` below is a one-way, domain-separated derivative of it
 * (HKDF, never the key itself), stored server-side so a Cloud Function can
 * confirm "this caller holds K valid Shamir shares" — and therefore
 * satisfy firestore.rules' OTP gate — without ever learning the shares,
 * the wrap key, or the seed. Because it's derived from the wrap key
 * specifically (not the seed, and not anything the passphrase path
 * touches), reproducing it requires real Shamir shares; the passphrase
 * alone cannot produce it.
 */

export interface ShamirSplitResult {
  shares: Uint8Array[];
  wrappedSeed: ShamirWrappedSeed;
  otpBypassVerifier: Uint8Array;
}

function deriveShamirOtpBypassVerifier(wrapKey: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    wrapKey,
    undefined,
    utf8ToBytes(SHAMIR_OTP_BYPASS_INFO),
    SHAMIR_OTP_BYPASS_VERIFIER_LENGTH
  );
}

/**
 * Wraps `masterSeed` under a fresh random AES-256 key, then splits that key
 * into `n` Shamir shares (`k` needed to reconstruct). Each share is 33 bytes
 * (32-byte key + 1-byte share index — see shamir-secret-sharing's GF(2^8)
 * encoding). Call again to reissue: a brand new key, ciphertext, and
 * `otpBypassVerifier` are generated every time, unrelated to any previous
 * call — reissuing invalidates old shares for OTP-bypass purposes exactly
 * as it does for decryption.
 */
export async function splitSeedShamir(
  masterSeed: Uint8Array,
  n: number,
  k: number
): Promise<ShamirSplitResult> {
  const wrapKey = randomBytes(SHAMIR_WRAP_KEY_LENGTH);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  try {
    const ciphertext = await aesGcmEncrypt(wrapKey, iv, masterSeed);
    const shares = await split(wrapKey, n, k);
    const otpBypassVerifier = deriveShamirOtpBypassVerifier(wrapKey);
    return { shares, wrappedSeed: { ciphertext, iv }, otpBypassVerifier };
  } finally {
    wipeBytes(wrapKey);
  }
}

/**
 * Reconstructs the master seed from Shamir shares plus the `wrappedSeed`
 * blob they were issued against (fetched from Firestore). Unlike raw
 * `shamir-secret-sharing` combine() — which does NOT validate its input,
 * silently producing garbage for wrong/insufficient shares — this is safe
 * to trust on success: AES-GCM's auth tag is the validity check, exactly
 * like `unwrapSeed()`'s WrongPassphraseError. Wrong, insufficient, or
 * shares from a since-reissued (and thus differently-wrapped) generation
 * all fail the same way.
 */
export async function combineSeedShamir(
  shares: Uint8Array[],
  wrappedSeed: ShamirWrappedSeed
): Promise<Uint8Array> {
  let wrapKey: Uint8Array;
  try {
    wrapKey = await combine(shares);
  } catch {
    throw new InvalidShamirSharesError();
  }
  try {
    return await aesGcmDecrypt(wrapKey, wrappedSeed.iv, wrappedSeed.ciphertext);
  } catch {
    throw new InvalidShamirSharesError();
  } finally {
    wipeBytes(wrapKey);
  }
}

/**
 * Computes the OTP-bypass proof for `shares` (ARCHITECTURE.md §3.8): the
 * same one-way derivative `splitSeedShamir` stored server-side, recomputed
 * here from whatever shares the caller has. Doesn't validate the shares
 * itself — combine() silently returns garbage for wrong/insufficient
 * shares, so this just as silently returns a garbage proof, which the
 * server-side comparison then simply fails to match. Callers that also
 * need the actual seed should validate via `combineSeedShamir` (AES-GCM
 * auth) first, both to fail fast locally and to avoid a wasted network
 * round-trip on shares that were never going to work anyway.
 */
export async function computeShamirOtpBypassProof(shares: Uint8Array[]): Promise<Uint8Array> {
  let wrapKey: Uint8Array;
  try {
    wrapKey = await combine(shares);
  } catch {
    throw new InvalidShamirSharesError();
  }
  try {
    return deriveShamirOtpBypassVerifier(wrapKey);
  } finally {
    wipeBytes(wrapKey);
  }
}
