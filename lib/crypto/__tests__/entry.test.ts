import { describe, expect, it } from "vitest";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { deriveHybridKeyPair } from "../keys";
import { generateMasterSeed } from "../random";
import { decryptEntry, encryptEntry } from "../entry";
import { aesGcmEncrypt } from "../aesGcm";
import { encapsulateContentKey } from "../hybridKem";
import {
  AES_GCM_IV_LENGTH,
  CONTENT_KEY_LENGTH,
  ENTRY_FORMAT_PADDED,
  MIN_PADDED_ENTRY_LENGTH,
} from "../constants";
import { TamperedCiphertextError } from "../errors";
import type { EncryptedEntryPayload, EntryAAD, HybridPublicKeysRaw } from "../types";

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

/**
 * Length padding (ARCHITECTURE.md §3.15). AES-GCM adds only a 16-byte tag,
 * so before this an entry's stored size WAS its plaintext size, readable
 * from the database by anyone with access and no key at all.
 */
describe("entry length padding", () => {
  it("stamps the format tag on the AAD so it is covered by the GCM tag", async () => {
    const { publicKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "오늘", aad());

    expect(entry.aad.fmt).toBe(ENTRY_FORMAT_PADDED);
  });

  it("hides the plaintext length: wildly different entries store identically", async () => {
    const { publicKeys } = deriveHybridKeyPair(generateMasterSeed());

    const sizes = await Promise.all(
      ["", "ㅠ", "힘든 하루였다.", "가".repeat(300)].map(async (text, index) =>
        (await encryptEntry(publicKeys, text, aad({ entrySeq: index + 1 }))).ciphertext.length
      )
    );

    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(MIN_PADDED_ENTRY_LENGTH + 16); // + AES-GCM tag
  });

  it("still bucket-collapses lengths well above the floor", async () => {
    const { publicKeys } = deriveHybridKeyPair(generateMasterSeed());

    const a = await encryptEntry(publicKeys, "가".repeat(3000), aad({ entrySeq: 1 }));
    const b = await encryptEntry(publicKeys, "가".repeat(3010), aad({ entrySeq: 2 }));

    expect(a.ciphertext.length).toBe(b.ciphertext.length);
  });

  it("round-trips content whose bytes are all zero", async () => {
    // The padding filler is also 0x00, so this is what a "strip trailing
    // zeros" scheme would corrupt. The length prefix is why it doesn't.
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const text = "\u0000\u0000\u0000";
    const entry = await encryptEntry(publicKeys, text, aad());

    await expect(decryptEntry(privateKeys, entry)).resolves.toBe(text);
  });

  /**
   * Builds an entry in the pre-padding format: raw UTF-8 plaintext, and an
   * AAD with no `fmt` key. `entries` is append-only, so documents written
   * before padding existed can never be rewritten — they have to keep
   * decrypting forever.
   */
  async function encryptLegacyUnpaddedEntry(
    recipientPublicKeys: HybridPublicKeysRaw,
    plaintext: string,
    entryAad: EntryAAD
  ): Promise<EncryptedEntryPayload> {
    const contentKey = randomBytes(CONTENT_KEY_LENGTH);
    const iv = randomBytes(AES_GCM_IV_LENGTH);
    const aadBytes = utf8ToBytes(
      JSON.stringify({
        uid: entryAad.uid,
        entrySeq: entryAad.entrySeq,
        createdAt: entryAad.createdAt,
      })
    );
    const ciphertext = await aesGcmEncrypt(contentKey, iv, utf8ToBytes(plaintext), aadBytes);
    const capsule = await encapsulateContentKey(recipientPublicKeys, contentKey);
    return {
      ciphertext,
      iv,
      wrappedContentKey: capsule.wrappedContentKey,
      wrappedContentKeyIv: capsule.wrappedContentKeyIv,
      kemCiphertext: capsule.kemCiphertext,
      ephemeralX25519PublicKey: capsule.ephemeralX25519PublicKey,
      aad: entryAad,
    };
  }

  it("still decrypts entries written before padding existed", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const legacy = await encryptLegacyUnpaddedEntry(publicKeys, "옛날 일기", aad());

    expect(legacy.aad.fmt).toBeUndefined();
    await expect(decryptEntry(privateKeys, legacy)).resolves.toBe("옛날 일기");
  });

  it("cannot be downgraded: stripping the format tag breaks the tag check", async () => {
    // The whole reason `fmt` lives in the AAD rather than in a bare
    // document field. Without this, an attacker could remove the tag and
    // make a padded entry decode as raw text — showing the reader a length
    // prefix and a kilobyte of NULs, with no indication anything was wrong.
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const entry = await encryptEntry(publicKeys, "secret", aad());

    const aadWithoutFormat: EntryAAD = {
      uid: entry.aad.uid,
      entrySeq: entry.aad.entrySeq,
      createdAt: entry.aad.createdAt,
    };
    const downgraded = { ...entry, aad: aadWithoutFormat };

    await expect(decryptEntry(privateKeys, downgraded)).rejects.toThrow(TamperedCiphertextError);
  });

  it("cannot be upgraded either: claiming padding on a legacy entry fails", async () => {
    const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
    const legacy = await encryptLegacyUnpaddedEntry(publicKeys, "옛날 일기", aad());

    const relabelled = { ...legacy, aad: { ...legacy.aad, fmt: ENTRY_FORMAT_PADDED } };

    await expect(decryptEntry(privateKeys, relabelled)).rejects.toThrow(TamperedCiphertextError);
  });
});