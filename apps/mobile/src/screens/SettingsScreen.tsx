import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { Globe, Laptop, LogOut, Monitor, Moon, Plus, Sun, X } from "lucide-react";
import type { MobileGrant } from "@pi-desktop/shared";
import type { MobileController, MobileView } from "../state/controller";
import { scopeLabel } from "../state/labels";
import { NotificationSettings } from "../features/notifications/NotificationSettings";
import { UpdateSection } from "../features/updates/UpdateSection";
import type { MobileUpdateView } from "../features/updates/useMobileUpdate";
import { Screen } from "../ui/Screen";
import { Row, Section, Segmented } from "../ui/controls";
import { Surface } from "../ui/Sheet";

export type ThemeChoice = "system" | "light" | "dark";

export function SettingsScreen({ controller, view, theme, setTheme, update, onPair }: {
  controller: MobileController; view: MobileView; theme: ThemeChoice; setTheme(theme: ThemeChoice): void; update: MobileUpdateView; onPair(): void;
}) {
  const { t, i18n } = useTranslation("translation", { keyPrefix: "mobile" });
  const [revoking, setRevoking] = useState<MobileGrant>();
  const [signingOut, setSigningOut] = useState(false);
  const native = Capacitor.isNativePlatform();
  const name = controller.account.session?.account.name ?? "MirrorCoding";
  const listed = new Set(view.directories.flatMap((directory) => directory.grants.map((grant) => grant.id)));
  const unlisted = view.grants.filter((grant) => !listed.has(grant.id));
  const grantChip = (grant: MobileGrant) => <span className="grant-chip" key={grant.id}>
    <span>{scopeLabel(grant, t)}</span>
    <button type="button" className="icon-button" aria-label={`${t("revoke")} · ${scopeLabel(grant, t)}`} onClick={() => setRevoking(grant)}><X size={14}/></button>
  </span>;
  return <Screen title={t("meTitle")}>
    <div className="account-card">
      <span className="avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "π"}</span>
      <div><strong>{name}</strong><small>MirrorCoding</small></div>
    </div>

    <Section title={t("computers")}>
      {view.directories.map((directory) => <div key={directory.desktopDeviceId}>
        <Row leading={<span className="computer-icon"><Laptop size={19}/></span>} title={directory.device.name}
          subtitle={<><span className={`dot ${directory.connection === "connected" ? "online" : ""}`}/> {t(directory.connection === "connected" ? "statusOnline" : directory.device.online ? "connecting" : "statusOffline")} · {t("projectCount", { count: directory.projects.length })}</>}/>
        <div className="grant-chips">{directory.grants.map(grantChip)}</div>
      </div>)}
      {unlisted.length > 0 && <div className="grant-chips unlisted">{unlisted.map(grantChip)}</div>}
      <Row leading={<Plus size={18}/>} title={t("pair")} onClick={onPair} chevron/>
    </Section>

    <NotificationSettings controller={controller} view={view} native={native}/>

    <Section title={t("appearance")}>
      <div className="setting-block">
        <strong>{t("theme")}</strong>
        <Segmented<ThemeChoice> label={t("theme")} value={theme} onChange={setTheme} options={[
          { value: "system", label: t("system"), icon: <Monitor size={15}/> },
          { value: "light", label: t("light"), icon: <Sun size={15}/> },
          { value: "dark", label: t("dark"), icon: <Moon size={15}/> },
        ]}/>
      </div>
      <Row leading={<Globe size={18}/>} title={t("language")} trailing={<select aria-label={t("language")} value={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
        onChange={(event) => { try { localStorage.setItem("pi.mobile.language", event.target.value); } catch { /* the choice still applies to this session */ } void i18n.changeLanguage(event.target.value); }}>
        <option value="en">English</option><option value="zh-CN">简体中文</option></select>}/>
    </Section>

    {native && <UpdateSection update={update}/>}

    <Section>
      <Row leading={<LogOut size={18}/>} title={t("logout")} danger onClick={() => setSigningOut(true)}/>
    </Section>
    <p className="version-footer">PI Mobile · v{update.version}</p>

    <Surface open={Boolean(revoking)} title={t("revoke")} variant="confirm" onClose={() => setRevoking(undefined)} footer={<div className="surface-actions">
      <button type="button" onClick={() => setRevoking(undefined)}>{t("no")}</button>
      <button type="button" className="button-danger" onClick={() => { const grant = revoking; setRevoking(undefined); if (grant) void controller.revoke(grant.id); }}>{t("yes")}</button>
    </div>}><p>{t("revokeConfirm")}</p></Surface>
    <Surface open={signingOut} title={t("logout")} variant="confirm" onClose={() => setSigningOut(false)} footer={<div className="surface-actions">
      <button type="button" onClick={() => setSigningOut(false)}>{t("cancel")}</button>
      <button type="button" className="button-danger" onClick={() => { setSigningOut(false); void controller.action(() => controller.logout()); }}>{t("logout")}</button>
    </div>}><p>{t("logoutConfirm")}</p></Surface>
  </Screen>;
}
