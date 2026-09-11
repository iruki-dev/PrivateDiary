import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  MLKEM768_SEED_INFO,
  MLKEM768_SEED_LENGTH,
  X25519_SEED_INFO,
  X25519_SEED_LENGTH,
} from "./constants";

export interface SubSeeds {
  classical: Uint8Array; // 32 bytes, feeds X25519 keygen
  postQuantum: Uint8Array; // 64 bytes, feeds ML-KEM-768 keygen
}

/**
 * Domain-separates the master seed into per-algorithm sub-seeds via
 * HKDF-SHA256 (ARCHITECTURE.md §3.1 step 2). Deterministic: same master seed
 * always yields the same sub-seeds, which is what makes key re-derivation
 * from the seed alone possible.
 */
export function deriveSubSeeds(masterSeed: Uint8Array): SubSeeds {
  return {
    classical: hkdf(
      sha256,
      masterSeed,
      undefined,
      utf8ToBytes(X25519_SEED_INFO),
      X25519_SEED_LENGTH
    ),
    postQuantum: hkdf(
      sha256,
      masterSeed,
      undefined,
      utf8ToBytes(MLKEM768_SEED_INFO),
      MLKEM768_SEED_LENGTH
    ),
  };
}
