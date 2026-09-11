import { describe, expect, it } from "vitest";
import { deriveHybridKeyPair } from "../keys";
import { generateMasterSeed } from "../random";
import { decryptEntry, encryptEntry } from "../entry";
import { TamperedCiphertextError } from "../errors";
import type { EntryAAD } from "../types";

function aad(overrides: Partial<EntryAAD> = {}): EntryAAD {
  return { uid: "user-1", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("encryptEntry / decryptEntry", () => {
  it("round-trips: write then read recovers the exact plaintext", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "오늘은 좋은 하루였다.", aad());

    const plaintext = await decryptEntry(privateKeys, entry);

    expect(plaintext).toBe("오늘은 좋은 하루였다.");
  });

  it("rejects a tampered AAD (entrySeq changed after encryption — rollback/substitution)", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "secret", aad({ entrySeq: 1 }));

    const tampered = { ...entry, aad: { ...entry.aad, entrySeq: 2 } };

    await expect(decryptEntry(privateKeys, tampered)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects a tampered kemCiphertext", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "secret", aad());

    const tamperedKemCiphertext = Uint8Array.from(entry.kemCiphertext);
    tamperedKemCiphertext[0] ^= 0xff;
    const tampered = { ...entry, kemCiphertext: tamperedKemCiphertext };

    await expect(decryptEntry(privateKeys, tampered)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects a tampered ephemeralX25519PublicKey", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "secret", aad());

    const tamperedEphemeral = Uint8Array.from(entry.ephemeralX25519PublicKey);
    tamperedEphemeral[0] ^= 0xff;
    const tampered = { ...entry, ephemeralX25519PublicKey: tamperedEphemeral };

    await expect(decryptEntry(privateKeys, tampered)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects a tampered ciphertext body", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "secret", aad());

    const tamperedCiphertext = Uint8Array.from(entry.ciphertext);
    tamperedCiphertext[0] ^= 0xff;
    const tampered = { ...entry, ciphertext: tamperedCiphertext };

    await expect(decryptEntry(privateKeys, tampered)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("cannot be opened by a different user's private keys", async () => {
    const owner = deriveHybridKeyPair(generateMasterSeed());
    const attacker = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(owner.publicKeys, "secret", aad());

    await expect(decryptEntry(attacker.privateKeys, entry)).rejects.toThrow(
      TamperedCiphertextError
    );
  });
});
