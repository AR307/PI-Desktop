import type { MobileDeviceCredentials } from "./device-credentials";
import { object, string } from "./validation";

/** Register once per authorization; an ordinary restart reuses the saved identity. */
export async function registerMobileDevice(
  credentials: Pick<MobileDeviceCredentials, "load" | "save">,
  accountId: string,
  authorizationId: string,
  name: string,
  request: (path: string, body: unknown) => Promise<unknown>,
): Promise<string> {
  const saved = await credentials.load(accountId);
  if (saved?.authorizationId === authorizationId) return saved.deviceId;
  const result = object(await request("/devices/register", {
    kind: "desktop", name,
    ...(saved ? { deviceId: saved.deviceId, deviceSecret: saved.deviceSecret } : {}),
  }));
  const deviceId = string(result.deviceId, "device_id");
  const secret = result.deviceSecret ?? (saved?.deviceId === deviceId ? saved.deviceSecret : undefined);
  if (typeof secret !== "string" || !secret) throw new Error("DEVICE_IDENTITY_MISSING");
  await credentials.save({ accountId, authorizationId, deviceId, deviceSecret: secret });
  return deviceId;
}
