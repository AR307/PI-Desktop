import type { MobileDirectoryPage, MobileGrant } from "@pi-desktop/shared";
import type { MobileDevice } from "./account";
import { dbDone, dbRequest, mobileDatabase } from "./mobile-db";

export type CachedAccount = { key: string; accountId: string; grants: MobileGrant[]; devices: MobileDevice[] };
export type CachedDirectory = MobileDirectoryPage & { key: string; accountId: string };
const directoryKey = (accountId: string, desktop: string) => JSON.stringify([accountId, desktop]);

export async function readAccount(accountId: string): Promise<CachedAccount | undefined> {
  const db = await mobileDatabase();
  return dbRequest(db.transaction("accounts").objectStore("accounts").get(accountId));
}
export async function saveAccount(accountId: string, grants: MobileGrant[], devices: MobileDevice[]): Promise<void> {
  const db = await mobileDatabase();
  const tx = db.transaction("accounts", "readwrite");
  const done = dbDone(tx);
  tx.objectStore("accounts").put({ key: accountId, accountId, grants, devices } satisfies CachedAccount);
  await done;
}
export async function readDirectory(accountId: string, desktopDeviceId: string): Promise<CachedDirectory | undefined> {
  const db = await mobileDatabase();
  return dbRequest(db.transaction("directories").objectStore("directories").get(directoryKey(accountId, desktopDeviceId)));
}
export async function saveDirectory(accountId: string, directory: MobileDirectoryPage): Promise<void> {
  const db = await mobileDatabase();
  const tx = db.transaction("directories", "readwrite");
  const done = dbDone(tx);
  tx.objectStore("directories").put({ ...directory, key: directoryKey(accountId, directory.desktopDeviceId), accountId } satisfies CachedDirectory);
  await done;
}
