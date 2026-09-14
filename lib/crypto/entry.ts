import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import { decapsulateContentKey, encapsulateContentKey } from "./hybridKem";
import { AES_GCM_IV_LENGTH, CONTENT_KEY_LENGTH, ENTRY_FORMAT_PADDED } from "./constants";
import { padEntryPlaintext, unpadEntryPlaintext } from "./padding";
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
 *
 * `fmt` is appended only when present, which is what keeps entries written
 * before length padding (§3.15) decryptable: their stored AAD has no `fmt`,
 * so they serialize to byte-for-byte what they were encrypted under. On
 * everything written since, `fmt` IS part of these bytes, so removing it
 * from the stored document breaks the tag instead of silently downgrading
 * the entry to an unpadded read.
 */
function canonicalAadBytes(aad: EntryAAD): Uint8Array {
  const base = { uid: aad.uid, entrySeq: aad.entrySeq, createdAt: aad.createdAt };
  return utf8ToBytes(JSON.stringify(aad.fmt ? { ...base, fmt: aad.fmt } : base));
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

  // Everything written from here on is length-padded (§3.15). The caller
  // does not get a say: an unpadded entry leaks its own size to anyone who
  // can read the database, and there is no situation where that is the
  // right trade for a diary. The format tag is stamped onto the AAD here
  // rather than trusted from the caller for the same reason.
  const stampedAad: EntryAAD = { ...aad, fmt: ENTRY_FORMAT_PADDED };
  const aadBytes = canonicalAadBytes(stampedAad);
  const record = padEntryPlaintext(utf8ToBytes(plaintext));

  const ciphertext = await aesGcmEncrypt(contentKey, iv, record, aadBytes);
  const capsule = await encapsulateContentKey(recipientPublicKeys, contentKey);
  wipeBytes(contentKey, record);

  return {
    ciphertext,
    iv,
    wrappedContentKey: capsule.wrappedContentKey,
    wrappedContentKeyIv: capsule.wrappedContentKeyIv,
    kemCiphertext: capsule.kemCiphertext,
    ephemeralX25519PublicKey: capsule.ephemeralX25519PublicKey,
    aad: stampedAad,
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
    const decrypted = await aesGcmDecrypt(contentKey, entry.iv, entry.ciphertext, aadBytes);
    // `fmt` reached us through the AAD, so the branch taken here was
    // authenticated by the tag check that just passed — an entry cannot be
    // steered down the wrong one. Its absence means an entry written
    // before §3.15, whose plaintext is raw UTF-8.
    const plaintext =
      entry.aad.fmt === ENTRY_FORMAT_PADDED ? unpadEntryPlaintext(decrypted) : decrypted;
    const text = new TextDecoder().decode(plaintext);
    wipeBytes(contentKey, decrypted, plaintext);
    return text;
  } catch {
    // Covers both an AEAD failure and a record whose authenticated length
    // prefix is nonsense (unpadEntryPlaintext's RangeError). Either way the
    // stored entry is not something this code wrote, which is exactly what
    // TamperedCiphertextError means.
    wipeBytes(contentKey);
    throw new TamperedCiphertextError();
  }
}
