import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Moon, Sun, Monitor, ChevronRight } from "lucide-react";
import type { MobileController } from "../state/controller";
import { Surface } from "./Surface";

export function AccountSheet({ open, close, controller, theme, setTheme }: {
  open: boolean; close(): void; controller: MobileController; theme: string; setTheme(theme: string): void;
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
      {controller.getSnapshot().signedIn && <button className="settings-row danger" onClick={() => setLogout(true)}><LogOut size={18}/>{t("logout")}</button>}
    </Surface>
    <Surface open={logout} title={t("logout")} variant="confirm" onClose={() => setLogout(false)} footer={<div className="surface-actions"><button onClick={() => setLogout(false)}>{t("cancel")}</button><button className="primary" onClick={() => { setLogout(false); close(); void controller.action(() => controller.logout()); }}>{t("logout")}</button></div>}><p>{t("logoutConfirm")}</p></Surface>
  </>;
}
