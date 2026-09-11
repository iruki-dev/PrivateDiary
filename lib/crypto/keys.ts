import { x25519 } from "@noble/curves/ed25519.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { deriveSubSeeds } from "./subSeeds";
import { MASTER_SEED_LENGTH } from "./constants";
import { wipeBytes } from "./memory";
import type { HybridKeyPair } from "./types";

/**
 * Deterministically derives the X25519 + ML-KEM-768 key pair from a master
 * seed (ARCHITECTURE.md §3.1 step 3). Calling this twice with the same seed
 * always yields byte-identical key pairs — verified in
 * lib/crypto/__tests__/keys.test.ts.
 *
 * The private keys returned here must never be persisted (rule 6): callers
 * keep them in memory only for the unlocked session and wipeBytes() them on
 * lock/logout.
 */
export function deriveHybridKeyPair(masterSeed: Uint8Array): HybridKeyPair {
  if (masterSeed.length !== MASTER_SEED_LENGTH) {
    throw new Error(`masterSeed must be ${MASTER_SEED_LENGTH} bytes`);
  }
  const subSeeds = deriveSubSeeds(masterSeed);

  const x25519KeyPair = x25519.keygen(subSeeds.classical);
  const mlkemKeyPair = ml_kem768.keygen(subSeeds.postQuantum);

  // @noble/curves' x25519.keygen(seed) returns a secretKey that ALIASES the
  // seed buffer it was given (the clamped seed itself, not a copy) — confirmed
  // against the installed version, not documented behavior to rely on
  // blindly. Copy it out before wiping subSeeds.classical, or wiping the
  // sub-seed would zero the private key we just derived.
  const x25519SecretKey = Uint8Array.from(x25519KeyPair.secretKey);

  wipeBytes(subSeeds.classical, subSeeds.postQuantum);

  return {
    publicKeys: {
      x25519PublicKey: x25519KeyPair.publicKey,
      mlkem768PublicKey: mlkemKeyPair.publicKey,
    },
    privateKeys: {
      x25519SecretKey,
      mlkem768SecretKey: mlkemKeyPair.secretKey,
    },
  };
}
