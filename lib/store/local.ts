/**
 * The fully local diary (Android app only): the same keys, wrapped seeds
 * and encrypted entries an account keeps in Firestore, kept instead in the
 * app's own IndexedDB on this phone — and nowhere else. While the app is
 * in this mode it also refuses every network request (MainActivity's
 * network block), so the diary is isolated from any server, ours included.
 *
 * Same crypto, same guarantees about what is stored: no passphrase, no
 * seed, no plaintext. What changes is who holds the ciphertext — and that
 * there is no server copy to fall back on, which the UI says plainly
 * (export and backup codes are the way to keep a copy).
 */
import {
  encryptEntry,
  publicKeysToStorage,
  shamirWrappedSeedToStorage,
  wrappedSeedToStorage,
  entryToStorage,
  type HybridPublicKeysRaw,
  type ShamirWrappedSeed,
  type WrappedSeed,
} from "@/lib/crypto";
import { assertNativeIntegrity } from "@/lib/security/nativeIntegrity";
import { normalizePreferences, type UserPreferences } from "@/lib/preferences";
import {
  getRecord,
  getRecordsByOwner,
  STORES,
  txDelete,
  txDeleteByOwner,
  txGet,
  txPut,
  writeTransaction,
} from "./idb";
import { entryListFromRecords, keyRecordFromStorage, newEntryId, type EntryRecord, type KeyRecordStorage } from "./records";
import type { DiaryStore, EntryList, UserKeyRecord, WriteEntryOptions } from "./types";

export interface LocalVaultRecord extends KeyRecordStorage {
  id: string;
  lastEntrySeq: number;
  createdAt: number;
  preferences: Partial<UserPreferences>;
  nickname: string | null;
}

interface LocalEntryRecord extends EntryRecord {
  vaultId: string;
}

export class LocalVaultMissingError extends Error {
  constructor() {
    super("This phone has no local diary yet.");
    this.name = "LocalVaultMissingError";
  }
}

export class LocalStore implements DiaryStore {
  readonly kind = "local" as const;
  readonly readOnly = false;

  constructor(readonly ownerId: string) {}

  private async vault(): Promise<LocalVaultRecord | undefined> {
    return getRecord<LocalVaultRecord>(STORES.localVaults, this.ownerId);
  }

  /** Read-modify-write of the diary record in one transaction. */
  private async updateVault(change: (vault: LocalVaultRecord) => LocalVaultRecord): Promise<void> {
    await writeTransaction([STORES.localVaults], async (tx) => {
      const vault = await txGet<LocalVaultRecord>(tx, STORES.localVaults, this.ownerId);
      if (!vault) throw new LocalVaultMissingError();
      await txPut(tx, STORES.localVaults, change(vault));
    });
  }

  async getKeyRecord(): Promise<UserKeyRecord | null> {
    const vault = await this.vault();
    return vault ? keyRecordFromStorage(vault) : null;
  }

  async createKeyRecord(publicKeys: HybridPublicKeysRaw, wrappedSeed: WrappedSeed): Promise<void> {
    await writeTransaction([STORES.localVaults], async (tx) => {
      if (await txGet(tx, STORES.localVaults, this.ownerId)) {
        throw new Error("This local diary already has keys");
      }
      const record: LocalVaultRecord = {
        id: this.ownerId,
        publicKeys: publicKeysToStorage(publicKeys),
        wrappedSeed: wrappedSeedToStorage(wrappedSeed),
        shamir: null,
        lastEntrySeq: 0,
        createdAt: Date.now(),
        preferences: {},
        nickname: null,
      };
      await txPut(tx, STORES.localVaults, record);
    });
  }

  async updateWrappedSeed(wrappedSeed: WrappedSeed): Promise<void> {
    await this.updateVault((vault) => ({ ...vault, wrappedSeed: wrappedSeedToStorage(wrappedSeed) }));
  }

  // The OTP-bypass verifier only means something to the server's OTP gate;
  // a local diary has no server and no OTP, so it isn't kept.
  async setShamir(n: number, k: number, wrappedSeed: ShamirWrappedSeed): Promise<void> {
    await this.updateVault((vault) => ({
      ...vault,
      shamir: { n, k, wrappedSeed: shamirWrappedSeedToStorage(wrappedSeed) },
    }));
  }

  async disableShamir(): Promise<void> {
    await this.updateVault((vault) => ({ ...vault, shamir: null }));
  }

  async getPreferences(): Promise<UserPreferences> {
    return normalizePreferences((await this.vault())?.preferences ?? {});
  }

  async setPreferences(patch: Partial<UserPreferences>): Promise<void> {
    await this.updateVault((vault) => ({ ...vault, preferences: { ...vault.preferences, ...patch } }));
  }

  async listEntries(): Promise<EntryList> {
    const [vault, records] = await Promise.all([
      this.vault(),
      getRecordsByOwner<LocalEntryRecord>(STORES.localEntries, this.ownerId),
    ]);
    return entryListFromRecords(this.ownerId, records, vault?.lastEntrySeq ?? null);
  }

  async writeEntry(publicKeys: HybridPublicKeysRaw, plaintext: string, options: WriteEntryOptions = {}): Promise<string> {
    assertNativeIntegrity();
    // Encrypting happens outside the IndexedDB transaction (which would
    // close while waiting on Web Crypto); the transaction then checks that
    // nothing else took the same number in between, and tries again if it did.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const vault = await this.vault();
      if (!vault) throw new LocalVaultMissingError();
      const entrySeq = vault.lastEntrySeq + 1;
      const writtenAt = options.createdAt ?? new Date();
      const payload = await encryptEntry(publicKeys, plaintext, {
        uid: this.ownerId,
        entrySeq,
        createdAt: writtenAt.toISOString(),
      });
      const record: LocalEntryRecord = {
        vaultId: this.ownerId,
        id: newEntryId(),
        entrySeq,
        createdAt: writtenAt.getTime(),
        storage: entryToStorage(payload),
      };
      const written = await writeTransaction([STORES.localVaults, STORES.localEntries], async (tx) => {
        const current = await txGet<LocalVaultRecord>(tx, STORES.localVaults, this.ownerId);
        if (!current) throw new LocalVaultMissingError();
        if (current.lastEntrySeq !== vault.lastEntrySeq) return false;
        await txPut(tx, STORES.localEntries, record);
        await txPut(tx, STORES.localVaults, { ...current, lastEntrySeq: entrySeq });
        return true;
      });
      if (written) return record.id;
    }
    throw new Error("Could not number the new entry");
  }

  async getNickname(): Promise<string | null> {
    return (await this.vault())?.nickname ?? null;
  }

  async setNickname(nickname: string): Promise<void> {
    await this.updateVault((vault) => ({ ...vault, nickname }));
  }
}

/** Whether this phone already holds a local diary with keys under `id`. */
export async function localDiaryExists(id: string): Promise<boolean> {
  try {
    return !!(await getRecord<LocalVaultRecord>(STORES.localVaults, id));
  } catch {
    return false;
  }
}

/** Erases a local diary and every entry in it from this phone. There is no other copy. */
export async function deleteLocalDiary(id: string): Promise<void> {
  await writeTransaction([STORES.localVaults, STORES.localEntries], async (tx) => {
    await txDeleteByOwner(tx, STORES.localEntries, id);
    await txDelete(tx, STORES.localVaults, id);
  });
}
