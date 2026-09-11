/**
 * Thin wrapper over native Web Crypto AES-GCM. Every AEAD operation in this
 * module (content body, content-key wrap, seed wrap) goes through here so
 * there is exactly one place that touches `crypto.subtle` for AES-GCM.
 *
 * Errors are propagated as-is (native DOMException on tag/AAD mismatch);
 * callers translate them into domain-specific errors (WrongPassphraseError,
 * TamperedCiphertextError) because the right message depends on context.
 */

async function importAesGcmKey(
  keyBytes: Uint8Array,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM" },
    false,
    [usage]
  );
}

export async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesGcmKey(keyBytes, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource | undefined },
    key,
    plaintext as BufferSource
  );
  return new Uint8Array(ciphertext);
}

export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesGcmKey(keyBytes, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource | undefined },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(plaintext);
}
