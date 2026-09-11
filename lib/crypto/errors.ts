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

/**
 * Thrown when combined Shamir shares don't reconstruct the expected seed.
 * shamir-secret-sharing's combine() never throws by itself on wrong/insufficient
 * shares (see lib/crypto/recovery.ts) — this is raised by our own verification
 * step instead.
 */
export class InvalidShamirSharesError extends Error {
  constructor(message = "These shares do not reconstruct the correct seed") {
    super(message);
    this.name = "InvalidShamirSharesError";
  }
}
