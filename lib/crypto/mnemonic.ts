import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { MASTER_SEED_LENGTH } from "./constants";
import { InvalidMnemonicError } from "./errors";

/**
 * Encodes the 32-byte master seed itself as a 24-word BIP39 mnemonic
 * (256 bits entropy + checksum = 24 words). This is a direct entropy<->words
 * codec, NOT the standard BIP39 `mnemonicToSeed` KDF (that derives a
 * different, irreversible 64-byte value meant for HD wallets) — see
 * ARCHITECTURE.md §3.1 step 6: the mnemonic must decode back to the exact
 * same master seed so the user's single backup reconstructs both key pairs.
 */
export function generateMnemonic(masterSeed: Uint8Array): string {
  if (masterSeed.length !== MASTER_SEED_LENGTH) {
    throw new Error(`masterSeed must be ${MASTER_SEED_LENGTH} bytes`);
  }
  return entropyToMnemonic(masterSeed, wordlist);
}

/** Inverse of generateMnemonic(). Throws InvalidMnemonicError on bad words/checksum. */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new InvalidMnemonicError();
  }
  const entropy = mnemonicToEntropy(mnemonic, wordlist);
  if (entropy.length !== MASTER_SEED_LENGTH) {
    throw new InvalidMnemonicError(
      `Expected ${MASTER_SEED_LENGTH}-byte seed, got ${entropy.length} bytes — not a diary mnemonic`
    );
  }
  return entropy;
}
