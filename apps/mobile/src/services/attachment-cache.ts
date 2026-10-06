import type { TranscriptAddress } from "./transcript-cache";
import { cacheKey } from "./transcript-cache";
import { dbDone, dbRequest, mobileDatabase } from "./mobile-db";

type CachedAttachment = TranscriptAddress & { key: string; sessionKey: string; messageId: string; blob: Blob; name: string };
const attachmentKey = (address: TranscriptAddress, message: string, attachment: string) => JSON.stringify([cacheKey(address), message, attachment]);

export async function readAttachment(address: TranscriptAddress, message: string, attachment: string): Promise<{ blob: Blob; name: string } | undefined> {
  const db = await mobileDatabase();
  return dbRequest<CachedAttachment | undefined>(db.transaction("attachments").objectStore("attachments").get(attachmentKey(address, message, attachment)));
}
export async function cacheAttachment(address: TranscriptAddress, messageId: string, attachment: string, result: { blob: Blob; name: string }, current: () => boolean): Promise<void> {
  const db = await mobileDatabase();
  if (!current()) return;
  const tx = db.transaction("attachments", "readwrite");
  const done = dbDone(tx);
  tx.objectStore("attachments").put({ ...address, ...result, messageId, key: attachmentKey(address, messageId, attachment), sessionKey: cacheKey(address) } satisfies CachedAttachment);
  await done;
}
