import { describe, expect, it } from "vitest";
import { isNewerUpdate, MobileUpdater, parseManifest, type InstalledVersion, type MobileUpdateTransport } from "../src/services/mobile-update";

const installed: InstalledVersion = { versionName: "0.16.1", versionCode: 4, androidSdk: 35 };
const manifest = { versionName: "0.16.2", versionCode: 5, minAndroidSdk: 24, apkUrl: "https://github.com/AR307/Mirrorcoding-APP/releases/download/v0.16.2/pi-mobile-v0.16.2.apk", releaseNotes: "Delta sync and update checks" };

describe("mobile update user path", () => {
  it("accepts the official manifest and only offers a newer compatible package", () => {
    expect(parseManifest(manifest)).toEqual(manifest);
    expect(isNewerUpdate(manifest, installed)).toBe(true);
    expect(isNewerUpdate({ ...manifest, versionCode: 4 }, installed)).toBe(false);
    expect(isNewerUpdate({ ...manifest, minAndroidSdk: 36 }, installed)).toBe(false);
  });

  it("rejects untrusted download origins", () => {
    expect(() => parseManifest({ ...manifest, apkUrl: "https://example.invalid/update.apk" })).toThrow("Invalid mobile update URL");
  });

  it("checks once per day and reuses the cached available update", async () => {
    const values = new Map<string, string>();
    let checks = 0;
    const transport: MobileUpdateTransport = {
      getInstalledInfo: async () => installed,
      fetchManifest: async () => { checks++; return { manifest }; },
      startDownload: async () => undefined,
      getDownload: async () => ({ status: "idle", downloadedBytes: 0, totalBytes: 0 }),
      cancelDownload: async () => undefined,
      install: async () => ({ permissionRequired: false }),
    };
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const updater = new MobileUpdater(transport, storage);
    expect((await updater.check()).manifest?.versionName).toBe("0.16.2");
    expect((await updater.check()).manifest?.versionName).toBe("0.16.2");
    expect(checks).toBe(1);
    expect((await updater.check(true)).manifest?.versionName).toBe("0.16.2");
    expect(checks).toBe(2);
  });
});
