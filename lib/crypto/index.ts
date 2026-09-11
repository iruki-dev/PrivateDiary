/**
 * Public surface of lib/crypto. ARCHITECTURE.md rule 3: every other
 * component (UI, lib/firebase) must import crypto/key-derivation
 * functionality ONLY from this barrel — never reach into a sibling file
 * directly, and never call Web Crypto / @noble / @simplewebauthn crypto
 * primitives outside this directory. That keeps the entire encryption
 * surface auditable from one place.
 *
 * This module and everything it imports must never import network or
 * Firebase code (no `firebase/*`, no `fetch`, no `lib/firebase/*`).
 */

export { generateMasterSeed } from "./random";
export { deriveSubSeeds } from "./subSeeds";
export type { SubSeeds } from "./subSeeds";

export { deriveHybridKeyPair } from "./keys";

export { wrapSeed, unwrapSeed, rewrapSeed } from "./passphrase";

export {
  RECOVERY_KEY_LENGTH,
  generateRecoveryKey,
  wrapSeedWithRecoveryKey,
  unwrapSeedWithRecoveryKey,
  splitSeedShamir,
  combineSeedShamir,
  seedMatchesPublicKeys,
} from "./recovery";

export { encapsulateContentKey, decapsulateContentKey } from "./hybridKem";
export type { ContentKeyCapsule } from "./hybridKem";

export { encryptEntry, decryptEntry } from "./entry";

export {
  publicKeysToStorage,
  publicKeysFromStorage,
  wrappedSeedToStorage,
  wrappedSeedFromStorage,
  recoveryKeyWrappedSeedToStorage,
  recoveryKeyWrappedSeedFromStorage,
  recoverySecretToText,
  textToRecoverySecret,
  entryToStorage,
  entryFromStorage,
} from "./codec";

export { wipeBytes } from "./memory";

export {
  WrongPassphraseError,
  TamperedCiphertextError,
  InvalidRecoveryKeyError,
  InvalidShamirSharesError,
} from "./errors";

export type {
  HybridKeyPair,
  HybridPrivateKeys,
  HybridPublicKeysRaw,
  HybridPublicKeysStorage,
  WrappedSeed,
  WrappedSeedStorage,
  DecryptionMethodsConfig,
  RecoveryKeyWrappedSeed,
  RecoveryKeyWrappedSeedStorage,
  EntryAAD,
  EncryptedEntryPayload,
  EncryptedEntryStorage,
} from "./types";
