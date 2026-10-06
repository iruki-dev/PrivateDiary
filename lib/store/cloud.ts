/**
 * The account's diary on the server (users/{uid} + entries), through the
 * existing lib/firebase modules — unchanged in what they write and how
 * firestore.rules gates it.
 *
 * In the Android app it also keeps the phone's copy current while
 * "이 휴대폰에 백업하기" is on for this account (lib/store/backup.ts): each
 * key record read, entry list read and entry written is copied over after
 * the server call has succeeded. Copying never decides the outcome — a
 * failed copy is logged and the server result stands.
 */
import { getUserKeyRecord, createUserKeyRecord, disableShamirMethod, getUserPreferences, setShamirMethod, setUserPreferences, updateWrappedSeed } from "@/lib/firebase/users";
import { listEntries, writeEntryRecord } from "@/lib/firebase/entries";
import { getNickname, setNickname } from "@/lib/firebase/profile";
import { IS_ANDROID_APP } from "@/lib/platform";
import type { UserPreferences } from "@/lib/preferences";
import type { HybridPublicKeysRaw, ShamirWrappedSeed, WrappedSeed } from "@/lib/crypto";
import { mergeBackupEntries, saveBackupKeyRecord } from "./backup";
import { entryRecordFromStored, keyRecordToStorage } from "./records";
import type { DiaryStore, EntryList, UserKeyRecord, WriteEntryOptions } from "./types";

function copyQuietly(work: () => Promise<void>) {
  if (!IS_ANDROID_APP) return;
  void work().catch((err) => console.error("copying to the phone's backup failed", err));
}

export class CloudStore implements DiaryStore {
  readonly kind = "cloud" as const;
  readonly readOnly = false;

  constructor(readonly ownerId: string) {}

  async getKeyRecord(): Promise<UserKeyRecord | null> {
    const record = await getUserKeyRecord(this.ownerId);
    if (record) copyQuietly(() => saveBackupKeyRecord(this.ownerId, keyRecordToStorage(record)));
    return record;
  }

  createKeyRecord(publicKeys: HybridPublicKeysRaw, wrappedSeed: WrappedSeed): Promise<void> {
    return createUserKeyRecord(this.ownerId, publicKeys, wrappedSeed);
  }

  /**
   * After a credential changes on the server, the phone's copy takes the
   * new wrapping at once: a passphrase change or a backup-code reissue is
   * meant to stop the old one from opening anything, the copy included.
   */
  private syncKeysToBackup() {
    copyQuietly(async () => {
      const record = await getUserKeyRecord(this.ownerId);
      if (record) await saveBackupKeyRecord(this.ownerId, keyRecordToStorage(record));
    });
  }

  async updateWrappedSeed(wrappedSeed: WrappedSeed): Promise<void> {
    await updateWrappedSeed(this.ownerId, wrappedSeed);
    this.syncKeysToBackup();
  }

  async setShamir(n: number, k: number, wrappedSeed: ShamirWrappedSeed, otpBypassVerifier: Uint8Array): Promise<void> {
    await setShamirMethod(this.ownerId, n, k, wrappedSeed, otpBypassVerifier);
    this.syncKeysToBackup();
  }

  async disableShamir(): Promise<void> {
    await disableShamirMethod(this.ownerId);
    this.syncKeysToBackup();
  }

  getPreferences(): Promise<UserPreferences> {
    return getUserPreferences(this.ownerId);
  }

  setPreferences(patch: Partial<UserPreferences>): Promise<void> {
    return setUserPreferences(this.ownerId, patch);
  }

  async listEntries(): Promise<EntryList> {
    const list = await listEntries(this.ownerId);
    copyQuietly(() =>
      mergeBackupEntries(
        this.ownerId,
        list.entries.map(entryRecordFromStored).filter((record) => record !== null),
        null
      )
    );
    return list;
  }

  async writeEntry(publicKeys: HybridPublicKeysRaw, plaintext: string, options?: WriteEntryOptions): Promise<string> {
    const written = await writeEntryRecord(this.ownerId, publicKeys, plaintext, options);
    copyQuietly(() =>
      mergeBackupEntries(
        this.ownerId,
        [{ id: written.id, entrySeq: written.entrySeq, createdAt: written.createdAt.getTime(), storage: written.storage }],
        written.entrySeq
      )
    );
    return written.id;
  }

  getNickname(): Promise<string | null> {
    return getNickname(this.ownerId);
  }

  setNickname(nickname: string): Promise<void> {
    return setNickname(this.ownerId, nickname);
  }
}
