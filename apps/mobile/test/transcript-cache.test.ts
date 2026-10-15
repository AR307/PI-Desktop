import { describe, expect, it } from "vitest";
import type { MobileGrant } from "@pi-desktop/shared";
import { cacheKey } from "../src/services/transcript-cache";
import { grantsForDesktop } from "../src/state/directories";

const grant: MobileGrant = {
  id: "account-grant", accountId: "account-one", mobileDeviceId: "phone",
  mobileDeviceName: "Phone", scope: { kind: "account", id: "account-one", label: "All opted-in computers" },
  createdAt: "2026-10-06T00:00:00Z",
};
describe("mobile account scope user path", () => {
  it("keeps the same session ID separate across computers and accounts", () => {
    const address = { accountId: "a", desktopDeviceId: "desktop", sessionId: "s" };
    expect(new Set([
      cacheKey(address), cacheKey({ ...address, accountId: "b" }),
      cacheKey({ ...address, desktopDeviceId: "desktop-two" }),
    ]).size).toBe(3);
  });
  it("one pairing discovers newly opted-in computers without expanding a scoped grant", () => {
    const desktop = { deviceId: "a", name: "Computer", kind: "desktop" as const, online: true, accountSyncEnabled: true };
    expect(grantsForDesktop([grant], desktop)).toEqual([grant]);
    expect(grantsForDesktop([grant], { ...desktop, deviceId: "new" })).toEqual([grant]);
    expect(grantsForDesktop([grant], { ...desktop, accountSyncEnabled: false })).toEqual([]);
    const scoped = { ...grant, desktopDeviceId: "a", scope: { kind: "session" as const, id: "s", label: "One chat" } };
    expect(grantsForDesktop([scoped], { ...desktop, deviceId: "new" })).toEqual([]);
    expect(grantsForDesktop([scoped], { ...desktop, accountSyncEnabled: false })).toEqual([scoped]);
  });
});
// Real IndexedDB paging, restart, offline read and deletion are exercised by
// apps/desktop/test/e2e/mobile/account-sync.mjs through the running mobile UI.
