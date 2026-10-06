import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptEntry,
  deriveHybridKeyPair,
  generateMasterSeed,
  splitSeedShamir,
  unwrapSeed,
  wrapSeed,
} from "@/lib/crypto";
import { deleteLocalDiary, LocalStore, localDiaryExists } from "../local";
import {
  BackupStore,
  deleteBackup,
  getBackupSummary,
  listBackups,
  mergeBackupEntries,
  saveBackupKeyRecord,
  startBackup,
} from "../backup";
import { keyRecordToStorage, newLocalDiaryId, type EntryRecord } from "../records";
import { ReadOnlyStoreError, type DiaryStore } from "../types";

async function freshKeys(passphrase = "quiet river paper lamp") {
  const seed = generateMasterSeed();
  const { publicKeys, privateKeys } = deriveHybridKeyPair(seed);
  const wrappedSeed = await wrapSeed(seed, passphrase);
  return { seed, publicKeys, privateKeys, wrappedSeed };
}

describe("LocalStore", () => {
  let id: string;
  beforeEach(() => {
    id = newLocalDiaryId();
  });

  it("has no keys until created, then reads back what the server would hold", async () => {
    const store = new LocalStore(id);
    expect(await store.getKeyRecord()).toBeNull();
    expect(await localDiaryExists(id)).toBe(false);

    const { seed, publicKeys, wrappedSeed } = await freshKeys();
    await store.createKeyRecord(publicKeys, wrappedSeed);
    expect(await localDiaryExists(id)).toBe(true);

    const record = await store.getKeyRecord();
    expect(record?.publicKeys).toEqual(publicKeys);
    expect(await unwrapSeed(record!.wrappedSeed, "quiet river paper lamp")).toEqual(seed);
    expect(record?.decryptionMethods).toEqual({ shamir: null });
    await expect(store.createKeyRecord(publicKeys, wrappedSeed)).rejects.toThrow();
  });

  it("writes entries that only the diary's keys can open, numbered 1..N with the original date kept", async () => {
    const store = new LocalStore(id);
    const { publicKeys, privateKeys, wrappedSeed } = await freshKeys();
    await store.createKeyRecord(publicKeys, wrappedSeed);

    await store.writeEntry(publicKeys, "첫째 날");
    const old = new Date("2024-05-01T03:00:00.000Z");
    await store.writeEntry(publicKeys, "불러온 옛 일기", { createdAt: old });

    const { entries, integrity } = await store.listEntries();
    expect(integrity.ok).toBe(true);
    expect(entries.map((e) => e.entrySeq)).toEqual([2, 1]);
    expect(entries[0].uid).toBe(id);
    expect(entries[0].createdAt?.toDate().toISOString()).toBe(old.toISOString());
    expect(entries[0].payload?.aad).toMatchObject({ uid: id, entrySeq: 2, createdAt: old.toISOString() });
    expect(await decryptEntry(privateKeys, entries[0].payload!)).toBe("불러온 옛 일기");
    expect(await decryptEntry(privateKeys, entries[1].payload!)).toBe("첫째 날");
  });

  it("keeps two writes started together on different numbers", async () => {
    const store = new LocalStore(id);
    const { publicKeys, wrappedSeed } = await freshKeys();
    await store.createKeyRecord(publicKeys, wrappedSeed);
    await Promise.all([store.writeEntry(publicKeys, "a"), store.writeEntry(publicKeys, "b"), store.writeEntry(publicKeys, "c")]);
    const { entries, integrity } = await store.listEntries();
    expect(entries.map((e) => e.entrySeq).sort()).toEqual([1, 2, 3]);
    expect(integrity.ok).toBe(true);
  });

  it("keeps its own preferences, nickname and backup codes", async () => {
    const store = new LocalStore(id);
    const { seed, publicKeys, wrappedSeed } = await freshKeys();
    await store.createKeyRecord(publicKeys, wrappedSeed);

    await store.setPreferences({ autoLockMinutes: 5 });
    expect((await store.getPreferences()).autoLockMinutes).toBe(5);
    await store.setNickname("하루");
    expect(await store.getNickname()).toBe("하루");

    const split = await splitSeedShamir(seed, 3, 2);
    // Through the interface every store shares; a local diary has no use for the verifier.
    await (store as DiaryStore).setShamir(3, 2, split.wrappedSeed, split.otpBypassVerifier);
    expect((await store.getKeyRecord())?.decryptionMethods).toEqual({ shamir: { n: 3, k: 2 } });
    await store.disableShamir();
    expect((await store.getKeyRecord())?.decryptionMethods).toEqual({ shamir: null });
  });

  it("never mixes two diaries, and erasing one leaves the other", async () => {
    const a = new LocalStore(id);
    const otherId = newLocalDiaryId();
    const b = new LocalStore(otherId);
    const keysA = await freshKeys();
    const keysB = await freshKeys();
    await a.createKeyRecord(keysA.publicKeys, keysA.wrappedSeed);
    await b.createKeyRecord(keysB.publicKeys, keysB.wrappedSeed);
    await a.writeEntry(keysA.publicKeys, "A");
    await b.writeEntry(keysB.publicKeys, "B");

    await deleteLocalDiary(id);
    expect(await a.getKeyRecord()).toBeNull();
    expect((await a.listEntries()).entries).toHaveLength(0);
    expect((await b.listEntries()).entries).toHaveLength(1);
  });
});

describe("phone backup of an account", () => {
  const uid = "uid_backup_test";

  beforeEach(async () => {
    await deleteBackup(uid);
  });

  function record(id: string, entrySeq: number, ciphertext = "Y3Q="): EntryRecord {
    return {
      id,
      entrySeq,
      createdAt: Date.UTC(2026, 0, entrySeq),
      storage: {
        ciphertext,
        iv: "aXY=",
        wrappedContentKey: "aw==",
        wrappedContentKeyIv: "aXY=",
        kemCiphertext: "a2Vt",
        ephemeralX25519PublicKey: "ZXBo",
        aad: { uid, entrySeq, createdAt: new Date(Date.UTC(2026, 0, entrySeq)).toISOString(), fmt: "padded-v1" },
      },
    };
  }

  it("copies nothing until it is switched on", async () => {
    const { publicKeys, wrappedSeed } = await freshKeys();
    const keys = keyRecordToStorage({ publicKeys, wrappedSeed, decryptionMethods: { shamir: null }, shamirWrappedSeed: null });
    await saveBackupKeyRecord(uid, keys);
    await mergeBackupEntries(uid, [record("e1", 1)], 1);
    expect(await getBackupSummary(uid)).toBeNull();
  });

  it("only ever adds: an entry the server stopped returning stays in the copy", async () => {
    const { publicKeys, wrappedSeed } = await freshKeys();
    const keys = keyRecordToStorage({ publicKeys, wrappedSeed, decryptionMethods: { shamir: null }, shamirWrappedSeed: null });
    await startBackup(uid, "diary_kim", keys);
    await mergeBackupEntries(uid, [record("e1", 1), record("e2", 2)], null);
    // The next listing no longer has e1 (the server lost it) — the copy keeps it.
    await mergeBackupEntries(uid, [record("e2", 2), record("e3", 3)], 3);

    const summary = await getBackupSummary(uid);
    expect(summary).toMatchObject({ uid, label: "diary_kim", entryCount: 3 });
    expect((await listBackups()).map((b) => b.uid)).toContain(uid);

    const copy = new BackupStore(uid);
    const { entries, integrity } = await copy.listEntries();
    expect(entries.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect(integrity.ok).toBe(true);
    expect((await copy.getKeyRecord())?.publicKeys).toEqual(publicKeys);
  });

  it("opens read-only", async () => {
    const copy = new BackupStore(uid);
    await expect(copy.writeEntry()).rejects.toBeInstanceOf(ReadOnlyStoreError);
    await expect(copy.updateWrappedSeed()).rejects.toBeInstanceOf(ReadOnlyStoreError);
    expect(copy.readOnly).toBe(true);
  });

  it("switching it off erases the copy", async () => {
    const { publicKeys, wrappedSeed } = await freshKeys();
    const keys = keyRecordToStorage({ publicKeys, wrappedSeed, decryptionMethods: { shamir: null }, shamirWrappedSeed: null });
    await startBackup(uid, "diary_kim", keys);
    await mergeBackupEntries(uid, [record("e1", 1)], 1);
    await deleteBackup(uid);
    expect(await getBackupSummary(uid)).toBeNull();
    expect((await new BackupStore(uid).listEntries()).entries).toHaveLength(0);
  });
});
