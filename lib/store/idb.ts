/**
 * The smallest IndexedDB wrapper the on-phone stores need (lib/store/local.ts,
 * lib/store/backup.ts). In the Android app this database lives in the app's
 * own sandbox, which is excluded from Android backup and device transfer
 * (android/.../res/xml/data_extraction_rules.xml).
 *
 * What goes in here is only ever what the server would hold anyway:
 * public keys, wrapped seeds and encrypted entries. Never a passphrase, a
 * seed or plaintext.
 */

const DB_NAME = "privatediary";
const DB_VERSION = 1;

export const STORES = {
  /** One record per fully local diary (lib/store/local.ts). */
  localVaults: "localVaults",
  /** Its encrypted entries, keyed [vaultId, id]. */
  localEntries: "localEntries",
  /** One record per cloud account backed up on this phone (lib/store/backup.ts). */
  backups: "backups",
  /** Their encrypted entries, keyed [uid, id]. */
  backupEntries: "backupEntries",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let opening: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openDatabase(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (!isIndexedDbAvailable()) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.localVaults)) {
          db.createObjectStore(STORES.localVaults, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORES.localEntries)) {
          const entries = db.createObjectStore(STORES.localEntries, { keyPath: ["vaultId", "id"] });
          entries.createIndex("byOwner", "vaultId");
        }
        if (!db.objectStoreNames.contains(STORES.backups)) {
          db.createObjectStore(STORES.backups, { keyPath: "uid" });
        }
        if (!db.objectStoreNames.contains(STORES.backupEntries)) {
          const entries = db.createObjectStore(STORES.backupEntries, { keyPath: ["uid", "id"] });
          entries.createIndex("byOwner", "uid");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    }).catch((err) => {
      // A failed open (storage blocked) can be retried later.
      opening = null;
      throw err;
    });
  }
  return opening;
}

export async function getRecord<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  return requestToPromise(db.transaction(store, "readonly").objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function getAllRecords<T>(store: StoreName): Promise<T[]> {
  const db = await openDatabase();
  return requestToPromise(db.transaction(store, "readonly").objectStore(store).getAll()) as Promise<T[]>;
}

/** Every record whose owner (vaultId / uid) is `owner`, via the "byOwner" index. */
export async function getRecordsByOwner<T>(store: StoreName, owner: string): Promise<T[]> {
  const db = await openDatabase();
  const index = db.transaction(store, "readonly").objectStore(store).index("byOwner");
  return requestToPromise(index.getAll(IDBKeyRange.only(owner))) as Promise<T[]>;
}

export async function countRecordsByOwner(store: StoreName, owner: string): Promise<number> {
  const db = await openDatabase();
  const index = db.transaction(store, "readonly").objectStore(store).index("byOwner");
  return requestToPromise(index.count(IDBKeyRange.only(owner)));
}

/**
 * Runs `work` inside one read-write transaction over `stores` and resolves
 * once it has committed — so a record and the counter that numbered it are
 * written together or not at all, the way lib/firebase/entries.ts batches
 * an entry with lastEntrySeq.
 */
export async function writeTransaction<T>(
  stores: StoreName[],
  work: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
  let result: T;
  try {
    result = await work(tx);
  } catch (err) {
    // The abort rejects `done` too; that outcome is `err`, reported below.
    done.catch(() => {});
    try {
      tx.abort();
    } catch {
      // Already finished.
    }
    throw err;
  }
  await done;
  return result;
}

/** A get inside a running transaction (see writeTransaction). */
export function txGet<T>(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return requestToPromise(tx.objectStore(store).get(key)) as Promise<T | undefined>;
}

export function txPut(tx: IDBTransaction, store: StoreName, value: unknown): Promise<IDBValidKey> {
  return requestToPromise(tx.objectStore(store).put(value));
}

/** Deletes every record of `owner` in an owner-indexed store, inside `tx`. */
export function txDeleteByOwner(tx: IDBTransaction, store: StoreName, owner: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = tx.objectStore(store).index("byOwner").openKeyCursor(IDBKeyRange.only(owner));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      tx.objectStore(store).delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
  });
}

export function txDelete(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<undefined> {
  return requestToPromise(tx.objectStore(store).delete(key));
}
