import type { MobileSessionSnapshot, RacpCursor, UiMessage } from "@pi-desktop/shared";
import { dbDone, dbRequest, mobileDatabase } from "./mobile-db";

export type TranscriptAddress = { accountId: string; desktopDeviceId: string; sessionId: string };
export type CachedTranscript = TranscriptAddress & {
  key: string;
  cursor?: RacpCursor;
  syncRevision: number;
  hasMoreHistory: boolean;
  oldestId?: string;
  oldestCreatedAt?: string;
  snapshot: MobileSessionSnapshot;
};
type StoredMessage = TranscriptAddress & { key: string; sessionKey: string; id: string; createdAt: string; message: UiMessage };
export type CachedPage = { entry?: CachedTranscript; messages: UiMessage[]; hasOlderCached: boolean };

export function cacheKey(address: TranscriptAddress): string {
  return JSON.stringify([address.accountId, address.desktopDeviceId, address.sessionId]);
}
const messageKey = (address: TranscriptAddress, id: string) => JSON.stringify([cacheKey(address), id]);

/** Each loaded message is retained. Only the visible page is read into memory. */
export class TranscriptCache {
  async page(address: TranscriptAddress, before?: UiMessage, limit = 50): Promise<CachedPage> {
    const db = await mobileDatabase();
    const transaction = db.transaction(["sessions", "messages"], "readonly");
    const key = cacheKey(address);
    const entryPromise = dbRequest<CachedTranscript | undefined>(transaction.objectStore("sessions").get(key));
    const range = IDBKeyRange.bound([key, "", ""], before ? [key, before.createdAt, before.id] : [key, "\uffff", "\uffff"], false, Boolean(before));
    const rows = await new Promise<StoredMessage[]>((resolve, reject) => {
      const rows: StoredMessage[] = [];
      const cursor = transaction.objectStore("messages").index("order").openCursor(range, "prev");
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        if (!cursor.result || rows.length > limit) { resolve(rows); return; }
        rows.push(cursor.result.value as StoredMessage);
        cursor.result.continue();
      };
    });
    return { entry: await entryPromise, messages: rows.slice(0, limit).reverse().map((row) => row.message), hasOlderCached: rows.length > limit };
  }

  async message(address: TranscriptAddress, id: string): Promise<UiMessage | undefined> {
    const db = await mobileDatabase();
    const row = await dbRequest<StoredMessage | undefined>(db.transaction("messages").objectStore("messages").get(messageKey(address, id)));
    return row?.message;
  }

  /** Contents and both applied positions advance in the same transaction. */
  async commit(entry: CachedTranscript, messages: readonly UiMessage[], deletedIds: readonly string[] = []): Promise<void> {
    const db = await mobileDatabase();
    const transaction = db.transaction(["sessions", "messages", "attachments"], "readwrite");
    const done = dbDone(transaction);
    transaction.objectStore("sessions").put(entry);
    const store = transaction.objectStore("messages");
    for (const id of deletedIds) store.delete(messageKey(entry, id));
    if (deletedIds.length) {
      const removed = new Set(deletedIds);
      const cursor = transaction.objectStore("attachments").index("sessionKey").openCursor(entry.key);
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        if (removed.has((cursor.result.value as { messageId: string }).messageId)) cursor.result.delete();
        cursor.result.continue();
      };
    }
    for (const message of messages) store.put({
      key: messageKey(entry, message.id), sessionKey: entry.key,
      accountId: entry.accountId, desktopDeviceId: entry.desktopDeviceId, sessionId: entry.sessionId,
      id: message.id, createdAt: message.createdAt, message,
    } satisfies StoredMessage);
    await done;
  }

  async clear(address: TranscriptAddress): Promise<void> {
    const db = await mobileDatabase();
    const transaction = db.transaction(["sessions", "messages", "attachments"], "readwrite");
    const done = dbDone(transaction);
    const key = cacheKey(address);
    transaction.objectStore("sessions").delete(key);
    for (const name of ["messages", "attachments"]) {
      const cursor = transaction.objectStore(name).index("sessionKey").openKeyCursor(key);
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        transaction.objectStore(name).delete(cursor.result.primaryKey);
        cursor.result.continue();
      };
    }
    await done;
  }
}

export function createTranscriptCache(): TranscriptCache { return new TranscriptCache(); }
