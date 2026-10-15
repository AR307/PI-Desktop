import { useTranslation } from "react-i18next";
import { Download, RefreshCw, Square } from "lucide-react";
import { Row, Section } from "../../ui/controls";
import type { MobileUpdateView } from "./useMobileUpdate";

/** Installed version, release notes and the native download/install flow. */
export function UpdateSection({ update }: { update: MobileUpdateView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const download = update.download;
  return <Section title={t("appUpdate")}>
    <Row title={t("version")} trailing={<span className="tabular">v{update.version}</span>}/>
    <div className="update-live" aria-live="polite">
      {update.manifest ? <>
        <p className="update-status">{t("updateAvailable", { version: update.manifest.versionName })}{update.manifest.releaseNotes ? `\n${update.manifest.releaseNotes}` : ""}</p>
        {download.status === "downloading" && <div className="update-progress">
          <progress max={download.totalBytes > 0 ? download.totalBytes : undefined} value={download.totalBytes > 0 ? download.downloadedBytes : undefined}/>
          <span className="tabular">{download.totalBytes > 0 ? `${Math.round(download.downloadedBytes / download.totalBytes * 100)}%` : t("updateDownloading")}</span>
        </div>}
        <div className="update-actions">
          {download.status === "downloading"
            ? <button type="button" onClick={() => void update.cancelDownload()}><Square size={15}/>{t("updateCancel")}</button>
            : download.status === "downloaded"
              ? <button type="button" className="button-primary" onClick={() => void update.install()}><Download size={15}/>{t("updateInstall")}</button>
              : <button type="button" className="button-primary" onClick={() => void update.startDownload()}><Download size={15}/>{download.status === "failed" ? t("updateRetry") : t("updateDownload")}</button>}
        </div>
        {update.installationPermission && <p className="update-status">{t("updatePermission")}</p>}
      </> : update.lastResult === "current" ? <p className="update-status">{t("updateCurrent")}</p> : null}
      {update.error && <p className="update-status error-text" role="alert">{t("updateUnavailable")} {update.error}</p>}
    </div>
    <Row leading={<RefreshCw size={18} className={update.checking ? "spin" : undefined}/>} title={update.checking ? t("updateChecking") : t("checkForUpdates")} onClick={update.checking ? undefined : () => void update.check(true)}/>
  </Section>;
}
