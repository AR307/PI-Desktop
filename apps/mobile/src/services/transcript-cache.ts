import type { RacpCursor, UiMessage } from "@pi-desktop/shared";

/**
 * On-device transcript cache (IndexedDB).
 *
 * Reopening a conversation renders the cached tail immediately and resumes
 * the event stream from the stored cursor instead of replaying a full
 * snapshot, so a stable session costs deltas only. Entries are cleared on
 * logout, on grant revocation, and when a grant disappears from the account,
 * because cached transcripts must never outlive the share that authorized
 * them. Cache failures degrade to the uncached path and never break the app.
 */
export type CachedTranscript = {
  /** `${desktopDeviceId}:${sessionId}` */
  key: string;
  desktopDeviceId: string;
  grantId: string;
  sessionId: string;
  cursor?: RacpCursor;
  revision: number;
  hasMoreHistory: boolean;
  messages: UiMessage[];
  updatedAt: number;
};

export interface TranscriptCache {
  get(desktopDeviceId: string, sessionId: string): Promise<CachedTranscript | undefined>;
  put(entry: CachedTranscript): Promise<void>;
  clearGrant(grantId: string): Promise<void>;
  clearAll(): Promise<void>;
}

const DB_NAME = "pi.mobile.transcripts";
const DB_VERSION = 1;
const STORE = "transcripts";
const GRANT_INDEX = "grantId";

/** Bound the stored tail so one long session cannot grow the cache unbounded. */
export const TRANSCRIPT_CACHE_MESSAGE_LIMIT = 500;

export function cacheKey(desktopDeviceId: string, sessionId: string): string {
  return `${desktopDeviceId}:${sessionId}`;
}

/** Trim to the newest bounded tail; the rest stays reachable via history paging. */
export function boundedCacheMessages(messages: readonly UiMessage[]): UiMessage[] {
  return messages.length > TRANSCRIPT_CACHE_MESSAGE_LIMIT
    ? messages.slice(messages.length - TRANSCRIPT_CACHE_MESSAGE_LIMIT)
    : [...messages];
}

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error("indexeddb request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb transaction failed"));
  });
}

class IndexedDbTranscriptCache implements TranscriptCache {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex(GRANT_INDEX, "grantId");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("indexeddb open failed"));
      open.onblocked = () => reject(new Error("indexeddb open blocked"));
    });
    return this.database;
  }

  async get(desktopDeviceId: string, sessionId: string): Promise<CachedTranscript | undefined> {
    const db = await this.open();
    const value = await request(
      db.transaction(STORE, "readonly").objectStore(STORE).get(cacheKey(desktopDeviceId, sessionId)),
    );
    return (value as CachedTranscript | undefined) ?? undefined;
  }

  async put(entry: CachedTranscript): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ ...entry, messages: boundedCacheMessages(entry.messages) });
    await transactionDone(transaction);
  }

  async clearGrant(grantId: string): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(STORE, "readwrite");
    const index = transaction.objectStore(STORE).index(GRANT_INDEX);
    const keys = await request(index.getAllKeys(grantId));
    for (const key of keys) transaction.objectStore(STORE).delete(key);
    await transactionDone(transaction);
  }

  async clearAll(): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    await transactionDone(transaction);
  }
}

/** In-memory stand-in for environments without IndexedDB (unit tests). */
export class MemoryTranscriptCache implements TranscriptCache {
  private readonly entries = new Map<string, CachedTranscript>();

  async get(desktopDeviceId: string, sessionId: string): Promise<CachedTranscript | undefined> {
    return this.entries.get(cacheKey(desktopDeviceId, sessionId));
  }

  async put(entry: CachedTranscript): Promise<void> {
    this.entries.set(entry.key, { ...entry, messages: boundedCacheMessages(entry.messages) });
  }

  async clearGrant(grantId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.grantId === grantId) this.entries.delete(key);
    }
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
  }
}

export function createTranscriptCache(): TranscriptCache {
  return typeof indexedDB === "undefined" ? new MemoryTranscriptCache() : new IndexedDbTranscriptCache();
}
