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

/**
 * `additionalData` is an optional AesGcmParams member — omitting it entirely
 * must mean "no AAD". Passing `additionalData: undefined` (present with an
 * undefined value, which is what every caller here used to do for callers
 * that don't use AAD, e.g. passphrase.ts's wrapSeed/unwrapSeed) is NOT the
 * same thing to every implementation: Node's WebCrypto and Firefox treat it
 * as absent, but Chromium (Chrome/Brave/Edge) throws `TypeError: AeadParams:
 * additionalData: Not a BufferSource` — silently breaking passphrase
 * wrap/unwrap, Shamir wrap/unwrap, and content-key wrapping on most
 * browsers by market share. The fix is to only add the key when there
 * actually is AAD, never set it to undefined.
 */
function aesGcmAlgorithm(iv: Uint8Array, aad?: Uint8Array): AesGcmParams {
  const algorithm: AesGcmParams = { name: "AES-GCM", iv: iv as BufferSource };
  if (aad) {
    algorithm.additionalData = aad as BufferSource;
  }
  return algorithm;
}

export async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesGcmKey(keyBytes, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(aesGcmAlgorithm(iv, aad), key, plaintext as BufferSource);
  return new Uint8Array(ciphertext);
}

export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesGcmKey(keyBytes, "decrypt");
  const plaintext = await crypto.subtle.decrypt(aesGcmAlgorithm(iv, aad), key, ciphertext as BufferSource);
  return new Uint8Array(plaintext);
}
