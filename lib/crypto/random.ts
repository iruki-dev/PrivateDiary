import { randomBytes } from "@noble/hashes/utils.js";
import { MASTER_SEED_LENGTH } from "./constants";

/**
 * Generates a fresh 32-byte master seed (ARCHITECTURE.md §3.1 step 1).
 * `@noble/hashes` randomBytes() sources from `crypto.getRandomValues`.
 */
export function generateMasterSeed(): Uint8Array {
  return randomBytes(MASTER_SEED_LENGTH);
}
