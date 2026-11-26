/**
 * "이 휴대폰에 백업하기" (Android app only): a copy of a cloud account's
 * diary kept on the phone, for the day the server can't be reached or has
 * lost something.
 *
 * What is copied is exactly what the server holds and nothing more — the
 * public keys, the passphrase-wrapped and backup-code-wrapped seeds, and
 * the encrypted entries. Opening the copy needs the diary passphrase (or
 * the backup codes), the same as opening the account.
 *
 * Kept up to date by lib/store/cloud.ts whenever the app reads or writes
 * the account while the backup is on: every key record it reads, every
 * entry it lists, every entry it writes. It only ever adds — an entry that
 * disappears from the server stays in the copy, since "the server lost
 * it" is exactly what this is for.
 *
 * For the same reason the server is not trusted to change what the copy
 * already holds: an entry already in the copy is never replaced (entries
 * can't be edited on the server, so a different ciphertext under the same
 * id can only be a broken or tampered server), and a key record whose
 * public keys differ from the copy's is refused. The passphrase and
 * backup-code wrappings do follow the server, so changing a credential
 * reaches the copy — but only when this phone next reads the account
 * online (see README, "이 휴대폰에 백업하기").
 *
 * The one thing it changes about the account's protection, stated in the
 * UI where it is switched on: 2-step verification is enforced by the
 * server when entries are fetched, so it can't guard a copy that is
 * already on the phone. The passphrase and the biometric check still do.
 */
import { normalizePreferences, type UserPreferences } from "@/lib/preferences";
import {
  countRecordsByOwner,
  getAllRecords,
  getRecord,
  getRecordsByOwner,
  isIndexedDbAvailable,
  STORES,
  txDelete,
  txDeleteByOwner,
  txGet,
  txPut,
  writeTransaction,
} from "./idb";
import { entryListFromRecords, keyRecordFromStorage, type EntryRecord, type KeyRecordStorage } from "./records";
import { ReadOnlyStoreError, type DiaryStore, type EntryList, type UserKeyRecord } from "./types";

export interface BackupRecord extends KeyRecordStorage {
  uid: string;
  /** How the account is named on the backup list: its login id, email or nickname. */
  label: string;
  lastEntrySeq: number | null;
  updatedAt: number;
}

interface BackupEntryRecord extends EntryRecord {
  uid: string;
}

export interface BackupSummary {
  uid: string;
  label: string;
  updatedAt: Date;
  entryCount: number;
}

export async function getBackupSummary(uid: string): Promise<BackupSummary | null> {
  if (!isIndexedDbAvailable()) return null;
  const record = await getRecord<BackupRecord>(STORES.backups, uid);
  if (!record) return null;
  return {
    uid,
    label: record.label,
    updatedAt: new Date(record.updatedAt),
    entryCount: await countRecordsByOwner(STORES.backupEntries, uid),
  };
}

export async function listBackups(): Promise<BackupSummary[]> {
  if (!isIndexedDbAvailable()) return [];
  const records = await getAllRecords<BackupRecord>(STORES.backups);
  const summaries = await Promise.all(records.map((record) => getBackupSummary(record.uid)));
  return summaries
    .filter((summary): summary is BackupSummary => summary !== null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Turns the backup on for `uid`, starting from its key record. Entries follow (mergeBackupEntries). */
export async function startBackup(uid: string, label: string, keys: KeyRecordStorage): Promise<void> {
  await writeTransaction([STORES.backups], async (tx) => {
    const existing = await txGet<BackupRecord>(tx, STORES.backups, uid);
    const record: BackupRecord = {
      ...keys,
      uid,
      label,
      lastEntrySeq: existing?.lastEntrySeq ?? null,
      updatedAt: Date.now(),
    };
    await txPut(tx, STORES.backups, record);
  });
}

/** The server sent public keys that don't match the copy's: refused, the copy is left as it was. */
export class BackupKeyMismatchError extends Error {
  constructor() {
    super("The server's public keys differ from the phone backup's; the backup was left unchanged");
    this.name = "BackupKeyMismatchError";
  }
}

function samePublicKeys(a: KeyRecordStorage["publicKeys"], b: KeyRecordStorage["publicKeys"]): boolean {
  return (
    a.mlkem768 === b.mlkem768 &&
    a.x25519.kty === b.x25519.kty &&
    a.x25519.crv === b.x25519.crv &&
    a.x25519.x === b.x25519.x
  );
}

/**
 * Refreshes the copied key record — only if the backup is on for `uid`.
 * The public keys never change for an account, so a record with other
 * public keys is refused (BackupKeyMismatchError) rather than letting the
 * server swap the copy's keys.
 */
export async function saveBackupKeyRecord(uid: string, keys: KeyRecordStorage): Promise<void> {
  await writeTransaction([STORES.backups], async (tx) => {
    const existing = await txGet<BackupRecord>(tx, STORES.backups, uid);
    if (!existing) return;
    if (!samePublicKeys(existing.publicKeys, keys.publicKeys)) throw new BackupKeyMismatchError();
    await txPut(tx, STORES.backups, { ...existing, ...keys, updatedAt: Date.now() });
  });
}

/**
 * Adds new entries to the copy — only if the backup is on for `uid`. Never
 * removes one, and never replaces one already there: the only thing taken
 * for an entry already in the copy is its date, when the copy had none yet
 * (an entry copied before its server time resolved). `lastEntrySeq` only
 * moves forward.
 */
export async function mergeBackupEntries(
  uid: string,
  entries: readonly EntryRecord[],
  lastEntrySeq: number | null
): Promise<void> {
  await writeTransaction([STORES.backups, STORES.backupEntries], async (tx) => {
    const existing = await txGet<BackupRecord>(tx, STORES.backups, uid);
    if (!existing) return;
    for (const entry of entries) {
      const already = await txGet<BackupEntryRecord>(tx, STORES.backupEntries, [uid, entry.id]);
      if (already) {
        if (already.createdAt === null && entry.createdAt !== null && already.entrySeq === entry.entrySeq) {
          await txPut(tx, STORES.backupEntries, { ...already, createdAt: entry.createdAt });
        }
        continue;
      }
      const record: BackupEntryRecord = { ...entry, uid };
      await txPut(tx, STORES.backupEntries, record);
    }
    const highest = Math.max(
      existing.lastEntrySeq ?? 0,
      lastEntrySeq ?? 0,
      ...entries.map((entry) => entry.entrySeq)
    );
    await txPut(tx, STORES.backups, {
      ...existing,
      lastEntrySeq: highest > 0 ? highest : existing.lastEntrySeq,
      updatedAt: Date.now(),
    });
  });
}

/** Turns the backup off for `uid` and erases the copy from this phone. */
export async function deleteBackup(uid: string): Promise<void> {
  await writeTransaction([STORES.backups, STORES.backupEntries], async (tx) => {
    await txDeleteByOwner(tx, STORES.backupEntries, uid);
    await txDelete(tx, STORES.backups, uid);
  });
}

/** The copy, opened on its own: reads only. */
export class BackupStore implements DiaryStore {
  readonly kind = "backup" as const;
  readonly readOnly = true;

  constructor(readonly ownerId: string) {}

  async getKeyRecord(): Promise<UserKeyRecord | null> {
    const record = await getRecord<BackupRecord>(STORES.backups, this.ownerId);
    return record ? keyRecordFromStorage(record) : null;
  }

  async listEntries(): Promise<EntryList> {
    const [record, entries] = await Promise.all([
      getRecord<BackupRecord>(STORES.backups, this.ownerId),
      getRecordsByOwner<BackupEntryRecord>(STORES.backupEntries, this.ownerId),
    ]);
    return entryListFromRecords(this.ownerId, entries, record?.lastEntrySeq ?? null);
  }

  // The account's preferences live on the server; the copy opens with the
  // defaults, which are the safe reading for every one of them.
  async getPreferences(): Promise<UserPreferences> {
    return normalizePreferences({});
  }

  async getNickname(): Promise<string | null> {
    return null;
  }

  async createKeyRecord(): Promise<void> {
    throw new ReadOnlyStoreError();
  }
  async updateWrappedSeed(): Promise<void> {
    throw new ReadOnlyStoreError();
  }
  async setShamir(): Promise<void> {
    throw new ReadOnlyStoreError();
  }
  async disableShamir(): Promise<void> {
    throw new ReadOnlyStoreError();
  }
  async setPreferences(): Promise<void> {
    throw new ReadOnlyStoreError();
  }
  async writeEntry(): Promise<string> {
    throw new ReadOnlyStoreError();
  }
  async setNickname(): Promise<void> {
    throw new ReadOnlyStoreError();
  }
}
