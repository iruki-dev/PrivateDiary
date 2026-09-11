/**
 * Domain-specific errors thrown by lib/crypto. Callers (UI layer) should catch
 * these specifically rather than pattern-matching on generic Error messages.
 */

/** Thrown by unwrapSeed/rewrapSeed when the passphrase is wrong (or wrappedSeed is corrupted). */
export class WrongPassphraseError extends Error {
  constructor(message = "Incorrect passphrase or corrupted wrapped seed") {
    super(message);
    this.name = "WrongPassphraseError";
  }
}

/** Thrown when AES-GCM authentication fails — tampered ciphertext, AAD, or hybrid capsule. */
export class TamperedCiphertextError extends Error {
  constructor(
    message = "Ciphertext or associated data failed authentication (possible tampering)"
  ) {
    super(message);
    this.name = "TamperedCiphertextError";
  }
}

/** Thrown by mnemonicToSeed on a malformed phrase or bad BIP39 checksum. */
export class InvalidMnemonicError extends Error {
  constructor(message = "Invalid mnemonic phrase or checksum") {
    super(message);
    this.name = "InvalidMnemonicError";
  }
}
