import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, LogOut, Moon, Sun, Monitor, ChevronRight, RefreshCw, Square } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { MobileController } from "../state/controller";
import { Surface } from "./Surface";
import type { MobileUpdateView } from "./useMobileUpdate";

export function AccountSheet({ open, close, controller, theme, setTheme, update }: {
  open: boolean; close(): void; controller: MobileController; theme: string; setTheme(theme: string): void; update: MobileUpdateView;
}) {
  const { t, i18n } = useTranslation("translation", { keyPrefix: "mobile" });
  const [logout, setLogout] = useState(false);
  return <>
    <Surface open={open} onClose={close} title={t("account")}>
      <div className="account-identity"><div className="avatar">π</div><div><strong>{controller.account.session?.account.name ?? "MirrorCoding"}</strong><small>{t("subtitle")}</small></div></div>
      <h3 className="field-heading">{t("theme")}</h3>
      <div className="segmented" role="group" aria-label={t("theme")}>
        {(["system", "light", "dark"] as const).map((value) => { const Icon = value === "system" ? Monitor : value === "light" ? Sun : Moon; return <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon size={16}/>{t(value)}</button>; })}
      </div>
      <label className="settings-row">{t("language")}<select aria-label={t("language")} value={i18n.language.startsWith("zh") ? "zh-CN" : "en"} onChange={(event) => { localStorage.setItem("pi.mobile.language", event.target.value); void i18n.changeLanguage(event.target.value); }}><option value="en">English</option><option value="zh-CN">简体中文</option></select><ChevronRight size={16}/></label>
      {Capacitor.isNativePlatform() && <section className="mobile-update-section" aria-live="polite">
        <div className="settings-row update-version"><span>{t("appUpdate")}</span><small className="muted">v{update.version}</small></div>
        {update.manifest ? <>
          <p className="muted update-notes">{t("updateAvailable", { version: update.manifest.versionName })}{update.manifest.releaseNotes ? `\n${update.manifest.releaseNotes}` : ""}</p>
          {update.download.status === "downloading" && <div className="update-progress"><progress max={update.download.totalBytes > 0 ? update.download.totalBytes : undefined} value={update.download.totalBytes > 0 ? update.download.downloadedBytes : undefined}/><span>{update.download.totalBytes > 0 ? `${Math.round(update.download.downloadedBytes / update.download.totalBytes * 100)}%` : t("updateDownloading")}</span></div>}
          <div className="surface-actions update-actions">
            {update.download.status === "downloading" ? <button onClick={() => void update.cancelDownload()}><Square size={15}/>{t("updateCancel")}</button> : update.download.status === "downloaded" ? <button className="primary" onClick={() => void update.install()}><Download size={15}/>{t("updateInstall")}</button> : <button className="primary" onClick={() => void update.startDownload()}><Download size={15}/>{update.download.status === "failed" ? t("updateRetry") : t("updateDownload")}</button>}
          </div>
          {update.installationPermission && <p className="muted update-notes">{t("updatePermission")}</p>}
        </> : <>
          {update.lastResult === "current" && <p className="muted update-notes">{t("updateCurrent")}</p>}
        </>}
        {update.error && <p className="error-text" role="alert">{t("updateUnavailable")} {update.error}</p>}
        <button className="settings-row update-check" disabled={update.checking} onClick={() => void update.check(true)}><RefreshCw size={16} className={update.checking ? "spin" : undefined}/>{update.checking ? t("updateChecking") : t("checkForUpdates")}</button>
      </section>}
      {controller.getSnapshot().signedIn && <button className="settings-row danger" onClick={() => setLogout(true)}><LogOut size={18}/>{t("logout")}</button>}
    </Surface>
    <Surface open={logout} title={t("logout")} variant="confirm" onClose={() => setLogout(false)} footer={<div className="surface-actions"><button onClick={() => setLogout(false)}>{t("cancel")}</button><button className="primary" onClick={() => { setLogout(false); close(); void controller.action(() => controller.logout()); }}>{t("logout")}</button></div>}><p>{t("logoutConfirm")}</p></Surface>
  </>;
}
