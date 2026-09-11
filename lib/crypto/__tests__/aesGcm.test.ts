import { describe, expect, it, vi } from "vitest";
import { aesGcmDecrypt, aesGcmEncrypt } from "../aesGcm";

/**
 * Regression test for a real browser bug (reported in production, Brave —
 * almost certainly all Chromium browsers): when no AAD is passed, the
 * algorithm object handed to crypto.subtle must NOT contain an
 * `additionalData` key at all, not even set to `undefined`. Node's WebCrypto
 * and Firefox tolerate `additionalData: undefined` as "no AAD", but Chromium
 * throws `TypeError: AeadParams: additionalData: Not a BufferSource` — which
 * silently broke passphrase wrap/unwrap (and everything else that omits
 * AAD) on most browsers by market share. Node's leniency is exactly why the
 * existing round-trip tests never caught this, so this test checks the
 * actual shape of the object passed to crypto.subtle directly instead of
 * relying on Node's forgiving implementation.
 */
describe("aesGcm AAD handling (Chromium strict-dictionary regression)", () => {
  const key = new Uint8Array(32).fill(7);
  const iv = new Uint8Array(12).fill(1);
  const plaintext = new Uint8Array([1, 2, 3]);

  it("does not set additionalData at all when no AAD is passed to aesGcmEncrypt", async () => {
    const spy = vi.spyOn(crypto.subtle, "encrypt");
    await aesGcmEncrypt(key, iv, plaintext);
    const algorithm = spy.mock.calls[0][0] as AesGcmParams;
    expect("additionalData" in algorithm).toBe(false);
    spy.mockRestore();
  });

  it("does not set additionalData at all when no AAD is passed to aesGcmDecrypt", async () => {
    const ciphertext = await aesGcmEncrypt(key, iv, plaintext);
    const spy = vi.spyOn(crypto.subtle, "decrypt");
    await aesGcmDecrypt(key, iv, ciphertext);
    const algorithm = spy.mock.calls[0][0] as AesGcmParams;
    expect("additionalData" in algorithm).toBe(false);
    spy.mockRestore();
  });

  it("does set additionalData when AAD is passed", async () => {
    const aad = new Uint8Array([9, 9, 9]);
    const spy = vi.spyOn(crypto.subtle, "encrypt");
    await aesGcmEncrypt(key, iv, plaintext, aad);
    const algorithm = spy.mock.calls[0][0] as AesGcmParams;
    expect(algorithm.additionalData).toBe(aad);
    spy.mockRestore();
  });

  it("round-trips correctly with no AAD", async () => {
    const ciphertext = await aesGcmEncrypt(key, iv, plaintext);
    const decrypted = await aesGcmDecrypt(key, iv, ciphertext);
    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips correctly with AAD", async () => {
    const aad = new Uint8Array([9, 9, 9]);
    const ciphertext = await aesGcmEncrypt(key, iv, plaintext, aad);
    const decrypted = await aesGcmDecrypt(key, iv, ciphertext, aad);
    expect(decrypted).toEqual(plaintext);
  });
});
