import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import { decapsulateContentKey, encapsulateContentKey } from "./hybridKem";
import { AES_GCM_IV_LENGTH, CONTENT_KEY_LENGTH } from "./constants";
import { TamperedCiphertextError } from "./errors";
import { wipeBytes } from "./memory";
import type {
  EncryptedEntryPayload,
  EntryAAD,
  HybridPrivateKeys,
  HybridPublicKeysRaw,
} from "./types";

/**
 * Fixed key order so the same AAD object always serializes to the same
 * bytes on both the encrypt and decrypt side (AES-GCM AAD must match
 * exactly). `entrySeq` is what §3.4's rollback/substitution defense binds on.
 */
function canonicalAadBytes(aad: EntryAAD): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({ uid: aad.uid, entrySeq: aad.entrySeq, createdAt: aad.createdAt })
  );
}

/**
 * Encrypts one diary entry for its owner's public keys (ARCHITECTURE.md
 * §3.2). Requires only the recipient's public keys — no seed or private key
 * needed, so this can run on any logged-in device (rule 5).
 *
 * `aad` is caller-supplied rather than computed here: assigning `entrySeq`
 * requires knowing the user's entry history, which is a Firestore concern
 * that lib/crypto must not depend on (rule 3 — this module imports no
 * network/Firebase code).
 */
export async function encryptEntry(
  recipientPublicKeys: HybridPublicKeysRaw,
  plaintext: string,
  aad: EntryAAD
): Promise<EncryptedEntryPayload> {
  const contentKey = randomBytes(CONTENT_KEY_LENGTH);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const aadBytes = canonicalAadBytes(aad);

  const ciphertext = await aesGcmEncrypt(contentKey, iv, utf8ToBytes(plaintext), aadBytes);
  const capsule = await encapsulateContentKey(recipientPublicKeys, contentKey);
  wipeBytes(contentKey);

  return {
    ciphertext,
    iv,
    wrappedContentKey: capsule.wrappedContentKey,
    wrappedContentKeyIv: capsule.wrappedContentKeyIv,
    kemCiphertext: capsule.kemCiphertext,
    ephemeralX25519PublicKey: capsule.ephemeralX25519PublicKey,
    aad,
  };
}

/**
 * Decrypts one diary entry (ARCHITECTURE.md §3.3). Requires the private
 * keys re-derived from the unlocked master seed. Throws
 * TamperedCiphertextError if the hybrid capsule, ciphertext, or AAD
 * (including a mismatched `entrySeq` — the rollback-detection binding) don't
 * all agree — never returns partially-trusted plaintext.
 */
export async function decryptEntry(
  privateKeys: HybridPrivateKeys,
  entry: EncryptedEntryPayload
): Promise<string> {
  const contentKey = await decapsulateContentKey(privateKeys, {
    wrappedContentKey: entry.wrappedContentKey,
    wrappedContentKeyIv: entry.wrappedContentKeyIv,
    kemCiphertext: entry.kemCiphertext,
    ephemeralX25519PublicKey: entry.ephemeralX25519PublicKey,
  });

  const aadBytes = canonicalAadBytes(entry.aad);
  try {
    const plaintext = await aesGcmDecrypt(contentKey, entry.iv, entry.ciphertext, aadBytes);
    wipeBytes(contentKey);
    return new TextDecoder().decode(plaintext);
  } catch {
    wipeBytes(contentKey);
    throw new TamperedCiphertextError();
  }
}
