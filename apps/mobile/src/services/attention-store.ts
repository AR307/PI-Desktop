import type { AttentionItem, AttentionStore } from "../state/attention";
import { dbDone, dbRequest, mobileDatabase } from "./mobile-db";

/** The Activity inbox persists beside the account's other offline data. */
export const indexedAttentionStore: AttentionStore = {
  async load(accountId) {
    const db = await mobileDatabase();
    return dbRequest<AttentionItem[]>(db.transaction("attention").objectStore("attention").index("accountId").getAll(accountId));
  },
  async save(items) {
    const db = await mobileDatabase();
    const transaction = db.transaction("attention", "readwrite");
    const done = dbDone(transaction);
    for (const item of items) transaction.objectStore("attention").put(item);
    await done;
  },
  async remove(keys) {
    const db = await mobileDatabase();
    const transaction = db.transaction("attention", "readwrite");
    const done = dbDone(transaction);
    for (const key of keys) transaction.objectStore("attention").delete(key);
    await done;
  },
};
