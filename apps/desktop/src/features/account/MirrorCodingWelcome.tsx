import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { AccountDialog } from "./AccountDialog";
import { observeMirrorCoding, useMirrorCoding } from "./state";
import "./account.css";

export function MirrorCodingWelcome() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const account = useMirrorCoding((state) => state.account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const welcomeLogin = useRef(false);
  useEffect(observeMirrorCoding, []);
  useEffect(() => {
    if (welcomeLogin.current && account?.status === "connected" && account.sync === "success") {
      welcomeLogin.current = false;
      if (useAppStore.getState().settings?.defaultProviderId) return;
      useAppStore.getState().setSettingsTab("account");
      useAppStore.getState().setPage("settings");
    }
  }, [account?.status, account?.sync]);
  if (!settings || settings.mirrorCodingWelcomeCompleted || !account) return null;
  const skip = async () => {
    setBusy(true); setError(false);
    try {
      welcomeLogin.current = false;
      await api.mirrorCodingCancel();
      await api.mirrorCodingCompleteWelcome();
      useAppStore.setState({ settings: await api.getSettings() });
    } catch { setError(true); } finally { setBusy(false); }
  };
  const login = async () => {
    welcomeLogin.current = true;
    setBusy(true); setError(false);
    try { await api.mirrorCodingLogin(); } catch { setError(true); } finally { setBusy(false); }
  };
  return <AccountDialog title={t("mirrorCoding.welcomeTitle")} onCancel={() => { if (!busy) void skip(); }}>
    <p>{t("mirrorCoding.welcomeDescription")}</p>
    {account.status === "authorizing" && <p role="status">{t("mirrorCoding.authorizing")}</p>}
    {(error || account.error) && <p className="mirrorcoding-error" role="alert">{t(`mirrorCoding.${account.error ?? "requestFailed"}`, { defaultValue: t("mirrorCoding.requestFailed") })}</p>}
    <div className="mirrorcoding-actions"><Button disabled={busy || account.status === "authorizing"} onClick={() => void login()}>{t("mirrorCoding.login")}</Button><Button variant="ghost" disabled={busy} onClick={() => void skip()}>{t("mirrorCoding.skip")}</Button></div>
  </AccountDialog>;
}
