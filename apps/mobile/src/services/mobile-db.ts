/** App-private, account-scoped storage. Credentials remain in native secure storage. */
const DB_NAME = "pi.mobile.transcripts";
const DB_VERSION = 2;
export const MOBILE_STORES = ["accounts", "directories", "sessions", "messages", "attachments"] as const;
let database: Promise<IDBDatabase> | undefined;

export function mobileDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      // The previous tail cache had no account identity and is no longer read.
      if (db.objectStoreNames.contains("transcripts")) db.deleteObjectStore("transcripts");
      for (const name of MOBILE_STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: "key" });
        store.createIndex("accountId", "accountId");
        if (name !== "accounts") store.createIndex("desktop", ["accountId", "desktopDeviceId"]);
        if (name === "messages") store.createIndex("order", ["sessionKey", "createdAt", "id"]);
        if (name === "messages" || name === "attachments") store.createIndex("sessionKey", "sessionKey");
      }
    };
    opening.onsuccess = () => {
      const db = opening.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    opening.onerror = () => { database = undefined; reject(opening.error); };
    opening.onblocked = () => { database = undefined; reject(new Error("cacheBlocked")); };
  });
  return database;
}

export function dbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("cacheFailed"));
  });
}

export function dbDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("cacheFailed"));
  });
}

export async function clearAccountCache(accountId: string): Promise<void> {
  const db = await mobileDatabase();
  const transaction = db.transaction([...MOBILE_STORES], "readwrite");
  const done = dbDone(transaction);
  for (const name of MOBILE_STORES) {
    const cursor = transaction.objectStore(name).index("accountId").openKeyCursor(accountId);
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      transaction.objectStore(name).delete(cursor.result.primaryKey);
      cursor.result.continue();
    };
  }
  await done;
}

export async function clearDesktopCache(accountId: string, desktopDeviceId: string): Promise<void> {
  const db = await mobileDatabase();
  const names = MOBILE_STORES.filter((name) => name !== "accounts");
  const transaction = db.transaction(names, "readwrite");
  const done = dbDone(transaction);
  for (const name of names) {
    const cursor = transaction.objectStore(name).index("desktop").openKeyCursor([accountId, desktopDeviceId]);
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      transaction.objectStore(name).delete(cursor.result.primaryKey);
      cursor.result.continue();
    };
  }
  await done;
}
