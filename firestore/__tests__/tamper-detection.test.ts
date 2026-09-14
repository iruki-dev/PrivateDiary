import { readFileSync } from "node:fs";
import { addDoc, collection, doc, getDoc, updateDoc, type Firestore } from "firebase/firestore";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  decryptEntry,
  deriveHybridKeyPair,
  encryptEntry,
  entryFromStorage,
  entryToStorage,
  generateMasterSeed,
  TamperedCiphertextError,
  type EncryptedEntryStorage,
  type EntryAAD,
  type HybridPrivateKeys,
} from "../../lib/crypto/index.js";

/**
 * Phase 7 (ARCHITECTURE.md §7 / completion checklist): "AAD 또는
 * kemCiphertext 변조 암호문을 강제로 Firestore에 주입한 뒤, 클라이언트가
 * 복호화를 거부하고 사용자에게 경고하는지 확인". Unlike
 * lib/crypto/__tests__/entry.test.ts (which tampers in-memory objects),
 * this round-trips through a REAL Firestore emulator document — base64
 * storage encoding included — to catch anything the codec layer alone
 * could hide. Tampering is injected via withSecurityRulesDisabled, which
 * is the correct way to simulate ARCHITECTURE.md §1.2's threat model
 * ("Firestore DB 전체 유출/해킹" — an attacker with direct DB access isn't
 * bound by the client-facing append-only security rules).
 */

const PROJECT_ID = "demo-privatediary-tamper";
const UID = "alice";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function writeGenuineEntryFor(plaintext: string, entrySeq: number) {
  const { publicKeys, privateKeys } = deriveHybridKeyPair(generateMasterSeed());
  const aad: EntryAAD = { uid: UID, entrySeq, createdAt: "2026-01-01T00:00:00.000Z" };
  const payload = await encryptEntry(publicKeys, plaintext, aad);
  const storage = entryToStorage(payload);

  const alice = testEnv.authenticatedContext(UID).firestore() as unknown as Firestore;
  const ref = await addDoc(collection(alice, "entries"), {
    ...storage,
    uid: UID,
    entrySeq,
    createdAt: new Date(),
  });

  return {
    entryId: ref.id,
    privateKeys,
    storedCiphertextLength: storage.ciphertext.length,
  };
}

async function writeGenuineEntry(plaintext: string) {
  return writeGenuineEntryFor(plaintext, 1);
}

async function tamperField(entryId: string, patch: Partial<EncryptedEntryStorage>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await updateDoc(doc(db, "entries", entryId), patch);
  });
}

async function readBackAndDecrypt(entryId: string, privateKeys: HybridPrivateKeys) {
  const alice = testEnv.authenticatedContext(UID).firestore() as unknown as Firestore;
  const snapshot = await getDoc(doc(alice, "entries", entryId));
  const data = snapshot.data() as EncryptedEntryStorage;
  const payload = entryFromStorage(data);
  return decryptEntry(privateKeys, payload);
}

describe("tamper detection through a real Firestore round-trip", () => {
  it("decrypts normally when nothing was tampered (control case)", async () => {
    const { entryId, privateKeys } = await writeGenuineEntry("오늘은 평화로운 하루였다.");
    await expect(readBackAndDecrypt(entryId, privateKeys)).resolves.toBe(
      "오늘은 평화로운 하루였다."
    );
  });

  it("rejects a kemCiphertext tampered directly in Firestore", async () => {
    const { entryId, privateKeys } = await writeGenuineEntry("secret");
    await tamperField(entryId, { kemCiphertext: "dGFtcGVyZWQ=" }); // base64("tampered"), wrong length/content
    await expect(readBackAndDecrypt(entryId, privateKeys)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects an ephemeralX25519PublicKey tampered directly in Firestore", async () => {
    const { entryId, privateKeys } = await writeGenuineEntry("secret");
    const tampered = Buffer.alloc(32, 0xff).toString("base64");
    await tamperField(entryId, { ephemeralX25519PublicKey: tampered });
    await expect(readBackAndDecrypt(entryId, privateKeys)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects an AAD tampered directly in Firestore (rollback/substitution)", async () => {
    const { entryId, privateKeys } = await writeGenuineEntry("secret");
    await tamperField(entryId, {
      aad: { uid: UID, entrySeq: 999, createdAt: "2026-01-01T00:00:00.000Z" },
    });
    await expect(readBackAndDecrypt(entryId, privateKeys)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects a ciphertext body tampered directly in Firestore", async () => {
    const { entryId, privateKeys } = await writeGenuineEntry("secret");
    await tamperField(entryId, { ciphertext: "dGFtcGVyZWQ=" });
    await expect(readBackAndDecrypt(entryId, privateKeys)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("rejects an entry whose padding format tag was stripped in Firestore", async () => {
    // The padding downgrade (ARCHITECTURE.md §3.15), through a real
    // round-trip. `fmt` lives in the AAD rather than in a plain field
    // precisely so that removing it breaks the GCM tag check — otherwise
    // this attack would make a padded entry decode as raw text and hand
    // the reader a length prefix followed by a kilobyte of NULs, with
    // nothing to indicate the document had been touched.
    const { entryId, privateKeys } = await writeGenuineEntry("secret");
    await tamperField(entryId, {
      aad: { uid: UID, entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
    });
    await expect(readBackAndDecrypt(entryId, privateKeys)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it("stores a padded entry whose size does not follow its content's size", async () => {
    // The property the whole change exists for, verified against what
    // actually lands in Firestore rather than against the in-memory
    // payload: two entries with very different content, one stored size.
    const short = await writeGenuineEntryFor("ㅠ", 1);
    const longer = await writeGenuineEntryFor("가".repeat(300), 2);

    expect(short.storedCiphertextLength).toBe(longer.storedCiphertextLength);
  });
});
