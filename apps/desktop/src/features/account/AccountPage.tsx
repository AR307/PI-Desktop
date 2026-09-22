import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { AccountDialog } from "./AccountDialog";
import { useMirrorCoding } from "./state";
import { MirrorCodingDefault } from "./MirrorCodingDefault";
import { MobileSyncSettings } from "../mobile-sync/MobileSyncSettings";
import "./account.css";

export function AccountPage() {
  const { t, i18n } = useTranslation();
  const account = useMirrorCoding((state) => state.account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<"login" | "logout">();
  const act = async (action: "login" | "logout" | "cancel" | "refresh" | "revoke", confirmed = false) => {
    setBusy(true); setError(undefined);
    try {
      if (action === "login" || action === "logout") {
        const result = action === "login" ? await api.mirrorCodingLogin(confirmed) : await api.mirrorCodingLogout(confirmed);
        if (result.confirmationRequired) { setConfirmation(action); return; }
        if (result.state) useMirrorCoding.setState({ account: result.state });
      } else {
        const state = await (action === "cancel" ? api.mirrorCodingCancel() : action === "refresh" ? api.mirrorCodingRefresh() : api.mirrorCodingRetryRevocation());
        useMirrorCoding.setState({ account: state });
      }
      setConfirmation(undefined);
    } catch { setError("requestFailed"); } finally { setBusy(false); }
  };
  if (!account) return <p role="status">{t("common.loading")}</p>;
  const connected = account.status === "connected" || account.status === "reauthorize";
  const date = (value: number) => new Date(value).toLocaleString(i18n.language);
  return (
    <div className="mirrorcoding-account">
      <section className="settings-card-block mirrorcoding-card">
        <div className="mirrorcoding-heading"><span className="mirrorcoding-mark" aria-hidden>MC</span><div><h2>{t("mirrorCoding.title")}</h2><p>{t("mirrorCoding.description")}</p></div></div>
        <p className="mirrorcoding-status" role="status">{t(`mirrorCoding.${account.status === "reauthorize" ? "reauthorizeStatus" : account.status}`)}</p>
        {account.account && <strong className="mirrorcoding-name">{account.account.display_name}</strong>}
        {account.authorizationExpiresAt && <p>{t("mirrorCoding.expires")}: {date(account.authorizationExpiresAt)}</p>}
        <div className="mirrorcoding-actions">
          {account.status === "authorizing" ? <Button disabled={busy} onClick={() => void act("cancel")}>{t("mirrorCoding.cancel")}</Button> : <Button disabled={busy} onClick={() => void act("login")}>{t(connected ? "mirrorCoding.reauthorize" : "mirrorCoding.login")}</Button>}
          {connected && <>
            <Button variant="ghost" disabled={busy} onClick={() => void act("login")}>{t("mirrorCoding.switchAccount")}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void act("logout")}>{t("mirrorCoding.logout")}</Button>
          </>}
        </div>
        {(error || account.error) && <p className="mirrorcoding-error" role="alert">{t(`mirrorCoding.${error ?? account.error}`, { defaultValue: t("mirrorCoding.requestFailed") })}</p>}
        {account.pendingRevocation && <div role="status"><p>{t("mirrorCoding.pendingRevocation")}</p><Button variant="ghost" disabled={busy} onClick={() => void act("revoke")}>{t("mirrorCoding.retryRevocation")}</Button></div>}
      </section>
      {connected && <section className="settings-card-block mirrorcoding-card">
        <div className="mirrorcoding-actions"><h3>{t("mirrorCoding.models", { count: new Set(account.catalog?.groups.flatMap((group) => group.models.map((model) => model.id))).size })}</h3><Button variant="ghost" disabled={busy || account.sync === "syncing"} onClick={() => void act("refresh")}>{t("mirrorCoding.refresh")}</Button></div>
        <p role="status">{t(`mirrorCoding.${account.sync}`)}{account.syncedAt ? ` · ${date(account.syncedAt)}` : ""}</p>
        {account.catalog?.groups.map((group) => <div key={group.id} className="mirrorcoding-group-summary"><div><strong>{group.name}</strong><p>{group.description}</p></div><span>{group.dynamic_billing ? t("mirrorCoding.dynamic") : `${group.ratio}×`}</span><span>{t("mirrorCoding.models", { count: group.models.length })}</span></div>)}
        {account.catalog?.groups.length === 0 && <p>{t("mirrorCoding.empty")}</p>}
      </section>}
      {connected && <MirrorCodingDefault />}
      {connected && <MobileSyncSettings />}
      {confirmation && <AccountDialog title={t("mirrorCoding.confirmTitle")} onCancel={() => setConfirmation(undefined)}><p>{t("mirrorCoding.confirmDescription")}</p><div className="mirrorcoding-actions"><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(undefined)}>{t("common.cancel")}</Button><Button disabled={busy} onClick={() => void act(confirmation, true)}>{t("mirrorCoding.confirm")}</Button></div></AccountDialog>}
    </div>
  );
}
