import { describe, expect, it } from "vitest";
import { deriveHybridKeyPair } from "../keys";
import { generateMasterSeed } from "../random";

describe("deriveHybridKeyPair", () => {
  it("is deterministic: same seed -> byte-identical key pairs", () => {
    const seed = generateMasterSeed();

    const first = deriveHybridKeyPair(seed);
    const second = deriveHybridKeyPair(seed);

    expect(first.publicKeys.x25519PublicKey).toEqual(second.publicKeys.x25519PublicKey);
    expect(first.publicKeys.mlkem768PublicKey).toEqual(second.publicKeys.mlkem768PublicKey);
    expect(first.privateKeys.x25519SecretKey).toEqual(second.privateKeys.x25519SecretKey);
    expect(first.privateKeys.mlkem768SecretKey).toEqual(second.privateKeys.mlkem768SecretKey);
  });

  it("different seeds produce different key pairs", () => {
    const a = deriveHybridKeyPair(generateMasterSeed());
    const b = deriveHybridKeyPair(generateMasterSeed());

    expect(a.publicKeys.x25519PublicKey).not.toEqual(b.publicKeys.x25519PublicKey);
    expect(a.publicKeys.mlkem768PublicKey).not.toEqual(b.publicKeys.mlkem768PublicKey);
  });

  it("produces keys of the expected wire lengths", () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());

    expect(publicKeys.x25519PublicKey).toHaveLength(32);
    expect(publicKeys.mlkem768PublicKey).toHaveLength(1184);
    expect(privateKeys.x25519SecretKey).toHaveLength(32);
    expect(privateKeys.mlkem768SecretKey).toHaveLength(2400);
  });

  it("rejects a seed of the wrong length", () => {
    expect(() => deriveHybridKeyPair(new Uint8Array(16))).toThrow();
  });
});
