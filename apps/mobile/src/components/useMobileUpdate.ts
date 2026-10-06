import { useCallback, useEffect, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { createMobileUpdater, MOBILE_WEB_VERSION, type DownloadState, type MobileUpdateManifest } from "../services/mobile-update";

const updater = createMobileUpdater();
const emptyDownload: DownloadState = { status: "idle", downloadedBytes: 0, totalBytes: 0 };

export type MobileUpdateView = {
  version: string;
  manifest: MobileUpdateManifest | null;
  download: DownloadState;
  checking: boolean;
  error: string | null;
  installationPermission: boolean;
  lastResult: "current" | "available" | null;
  check(manual?: boolean): Promise<void>;
  startDownload(): Promise<void>;
  cancelDownload(): Promise<void>;
  install(): Promise<boolean>;
};

export function useMobileUpdate(): MobileUpdateView {
  const [version, setVersion] = useState(MOBILE_WEB_VERSION);
  const [manifest, setManifest] = useState<MobileUpdateManifest | null>(null);
  const [download, setDownload] = useState<DownloadState>(emptyDownload);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installationPermission, setInstallationPermission] = useState(false);
  const resumeInstall = useRef(false);
  const [lastResult, setLastResult] = useState<"current" | "available" | null>(null);

  const check = useCallback(async (manual = false) => {
    if (!updater) return;
    setChecking(true); setError(null);
    try {
      const result = await updater.check(manual);
      setVersion(result.installed.versionName);
      setManifest(result.manifest);
      setLastResult(result.manifest ? "available" : "current");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setChecking(false); }
  }, []);

  const refreshDownload = useCallback(async () => {
    if (!updater) return;
    try { setDownload(await updater.downloadState()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);

  useEffect(() => {
    if (!updater) return;
    void updater.installed().then((value) => setVersion(value.versionName)).catch((cause: unknown) => setError(String(cause)));
    void refreshDownload();
    void check();
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void refreshDownload(); void check();
        if (resumeInstall.current) {
          resumeInstall.current = false;
          void updater.install().then((result) => { setInstallationPermission(result.permissionRequired); resumeInstall.current = result.permissionRequired; })
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
        }
      }
    });
    return () => { void listener.then((value) => value.remove()); };
  }, [check, refreshDownload]);

  useEffect(() => {
    if (download.status !== "downloading") return;
    const timer = window.setInterval(() => { void refreshDownload(); }, 800);
    return () => window.clearInterval(timer);
  }, [download.status, refreshDownload]);

  const startDownload = async () => {
    if (!updater || !manifest) return;
    setError(null);
    try { setDownload(await updater.download(manifest)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const cancelDownload = async () => {
    if (!updater) return;
    try { await updater.cancel(); setDownload(emptyDownload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const install = async (): Promise<boolean> => {
    if (!updater) return false;
    setError(null);
    try { const required = (await updater.install()).permissionRequired; setInstallationPermission(required); resumeInstall.current = required; return required; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
  };

  return { version, manifest, download, checking, error, installationPermission, lastResult, check, startDownload, cancelDownload, install };
}
