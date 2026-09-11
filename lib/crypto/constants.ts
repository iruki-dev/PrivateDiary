/**
 * Central algorithm/version constants for lib/crypto.
 * Changing any of these changes the wire format — bump the "-v1" suffix
 * and add a migration path (see ARCHITECTURE.md §8) instead of editing in place.
 */

export const MASTER_SEED_LENGTH = 32;

// HKDF info strings used to domain-separate the two sub-seeds derived from the
// master seed (ARCHITECTURE.md §3.1 step 2).
export const X25519_SEED_INFO = "diary-x25519-v1";
export const MLKEM768_SEED_INFO = "diary-mlkem768-v1";

// @noble/curves x25519.keygen(seed) expects a 32-byte seed;
// @noble/post-quantum ml_kem768.keygen(seed) expects a 64-byte seed
// (FIPS-203 Algorithm 16 input d || z). Verified against the installed
// library versions — see lib/crypto/__tests__/keys.test.ts determinism checks.
export const X25519_SEED_LENGTH = 32;
export const MLKEM768_SEED_LENGTH = 64;

export const CONTENT_KEY_LENGTH = 32; // AES-256
export const AES_GCM_IV_LENGTH = 12; // 96-bit nonce, standard for AES-GCM

// HKDF info string for deriving the AES key that wraps a per-entry content key
// from the hybrid (X25519 + ML-KEM-768) shared secrets (ARCHITECTURE.md §3.2).
export const CONTENT_KEY_WRAP_INFO = "diary-content-key-wrap-v1";

// Passphrase -> wrapping key KDF (ARCHITECTURE.md §3.6). PBKDF2 is the default
// because it's native to Web Crypto (no WASM, simpler CSP). Argon2id remains a
// documented opt-in in ARCHITECTURE.md but is not implemented here.
export const PBKDF2_SALT_LENGTH = 16;
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_HASH = "SHA-256" as const;

// Shamir path (ARCHITECTURE.md §3.7): shares split a random AES-256 key, not
// the master seed itself, so reissuing can actually invalidate old shares.
export const SHAMIR_WRAP_KEY_LENGTH = 32;
