import { randomBytes } from "@noble/hashes/utils.js";
import { MASTER_SEED_LENGTH } from "./constants";

/**
 * Generates a fresh 32-byte master seed (ARCHITECTURE.md §3.1 step 1).
 * `@noble/hashes` randomBytes() sources from `crypto.getRandomValues`.
 */
export function generateMasterSeed(): Uint8Array {
  return randomBytes(MASTER_SEED_LENGTH);
}

/**
 * A random identifier (not a secret): local diary ids, entry ids on the
 * phone. Kept here so nothing outside lib/crypto reaches for
 * crypto.getRandomValues itself (rule 3).
 */
export function randomId(byteLength = 15): string {
  return Array.from(randomBytes(byteLength), (b) => b.toString(16).padStart(2, "0")).join("");
}
