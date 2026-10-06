import { Capacitor, registerPlugin } from "@capacitor/core";
import packageJson from "../../package.json";

const LAST_CHECK_KEY = "pi.mobile.update.lastCheck";
const LAST_MANIFEST_KEY = "pi.mobile.update.manifest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type MobileUpdateManifest = {
  versionName: string;
  versionCode: number;
  minAndroidSdk: number;
  apkUrl: string;
  releaseNotes: string;
};

export type InstalledVersion = { versionName: string; versionCode: number; androidSdk: number };
export type DownloadState = { status: "idle" | "downloading" | "downloaded" | "failed"; downloadedBytes: number; totalBytes: number; reason?: number };
export type InstallResult = { permissionRequired: boolean };

export interface MobileUpdateTransport {
  getInstalledInfo(): Promise<InstalledVersion>;
  fetchManifest(options?: { url?: string }): Promise<{ manifest: unknown }>;
  startDownload(options: { url: string }): Promise<void>;
  getDownload(): Promise<DownloadState>;
  cancelDownload(): Promise<void>;
  install(): Promise<InstallResult>;
}

const nativeUpdate = registerPlugin<MobileUpdateTransport>("MobileUpdate");

export function parseManifest(value: unknown, allowFixture = false): MobileUpdateManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid mobile update manifest");
  const row = value as Record<string, unknown>;
  if (typeof row.versionName !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(row.versionName)
    || !Number.isSafeInteger(row.versionCode) || Number(row.versionCode) < 1
    || !Number.isSafeInteger(row.minAndroidSdk) || Number(row.minAndroidSdk) < 24
    || typeof row.apkUrl !== "string" || typeof row.releaseNotes !== "string") {
    throw new Error("Invalid mobile update manifest");
  }
  const url = new URL(row.apkUrl);
  const official = url.protocol === "https:" && url.hostname === "github.com"
    && url.pathname.startsWith("/AR307/Mirrorcoding-APP/releases/download/");
  const fixture = allowFixture && url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname);
  if ((!official && !fixture) || !url.pathname.endsWith(".apk")) throw new Error("Invalid mobile update URL");
  return {
    versionName: row.versionName, versionCode: Number(row.versionCode), minAndroidSdk: Number(row.minAndroidSdk),
    apkUrl: url.toString(), releaseNotes: row.releaseNotes,
  };
}

export function isNewerUpdate(manifest: MobileUpdateManifest, installed: InstalledVersion): boolean {
  return manifest.versionCode > installed.versionCode && manifest.minAndroidSdk <= installed.androidSdk;
}

export class MobileUpdater {
  constructor(private readonly transport: MobileUpdateTransport, private readonly storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {}

  async installed(): Promise<InstalledVersion> { return this.transport.getInstalledInfo(); }
  async downloadState(): Promise<DownloadState> { return this.transport.getDownload(); }
  async savedUpdate(): Promise<MobileUpdateManifest | null> {
    const saved = this.storage.getItem(LAST_MANIFEST_KEY);
    if (!saved) return null;
    try {
      const manifest = parseManifest(JSON.parse(saved), import.meta.env.MODE === "acceptance");
      return isNewerUpdate(manifest, await this.installed()) ? manifest : null;
    } catch { return null; }
  }

  async check(manual = false): Promise<{ installed: InstalledVersion; manifest: MobileUpdateManifest | null; checked: boolean }> {
    const installed = await this.installed();
    const lastCheck = Number(this.storage.getItem(LAST_CHECK_KEY) ?? 0);
    if (!manual && lastCheck > 0 && Date.now() - lastCheck < CHECK_INTERVAL_MS) {
      const cached = await this.savedUpdate();
      return { installed, manifest: cached && isNewerUpdate(cached, installed) ? cached : null, checked: false };
    }
    const fixtureUrl = import.meta.env.MODE === "acceptance" ? import.meta.env.VITE_MOBILE_UPDATE_MANIFEST_URL : undefined;
    const manifest = parseManifest((await this.transport.fetchManifest(fixtureUrl ? { url: fixtureUrl } : undefined)).manifest, import.meta.env.MODE === "acceptance");
    this.storage.setItem(LAST_MANIFEST_KEY, JSON.stringify(manifest));
    this.storage.setItem(LAST_CHECK_KEY, String(Date.now()));
    return { installed, manifest: isNewerUpdate(manifest, installed) ? manifest : null, checked: true };
  }

  async download(manifest: MobileUpdateManifest): Promise<DownloadState> {
    await this.transport.startDownload({ url: manifest.apkUrl });
    return this.downloadState();
  }
  async cancel(): Promise<void> { await this.transport.cancelDownload(); }
  async install(): Promise<InstallResult> { return this.transport.install(); }
}

export function createMobileUpdater(): MobileUpdater | null {
  return Capacitor.isNativePlatform() ? new MobileUpdater(nativeUpdate) : null;
}

export const MOBILE_WEB_VERSION = packageJson.version;
