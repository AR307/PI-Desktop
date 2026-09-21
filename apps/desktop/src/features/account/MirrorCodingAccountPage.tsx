import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { AccountDialog } from "./AccountDialog";
import { observeMirrorCoding, useMirrorCoding } from "./state";
import { MobileSyncSettings } from "../mobile-sync/MobileSyncSettings";
import "./account.css";

export function MirrorCodingAccountPage() {
  const { t, i18n } = useTranslation();
  const account = useMirrorCoding((state) => state.account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<"login" | "logout">();

  useEffect(() => observeMirrorCoding(), []);

  const run = async (action: "login" | "logout" | "cancel" | "refresh" | "revoke", confirmed = false) => {
    setBusy(true);
    setError(undefined);
    try {
      if (action === "login" || action === "logout") {
        const result = action === "login"
          ? await api.mirrorCodingLogin(confirmed)
          : await api.mirrorCodingLogout(confirmed);
        if (result.confirmationRequired) {
          setConfirmation(action);
          return;
        }
        if (result.state) useMirrorCoding.setState({ account: result.state });
      } else {
        const next = action === "cancel"
          ? await api.mirrorCodingCancel()
          : action === "refresh"
            ? await api.mirrorCodingRefresh()
            : await api.mirrorCodingRetryRevocation();
        useMirrorCoding.setState({ account: next });
      }
      setConfirmation(undefined);
    } catch {
      setError("requestFailed");
    } finally {
      setBusy(false);
    }
  };

  const date = (value: number) => new Date(value).toLocaleString(i18n.language);
  const connected = account?.status === "connected" || account?.status === "reauthorize";
  const modelCount = useMemo(
    () => new Set(account?.catalog?.groups.flatMap((group) => group.models.map((model) => model.id))).size,
    [account?.catalog],
  );

  if (!account) return <p role="status">{t("common.loading")}</p>;

  return (
    <div className="mirrorcoding-account">
      <section className="settings-card-block mirrorcoding-card">
        <div className="mirrorcoding-heading">
          <span className="mirrorcoding-mark" aria-hidden>MC</span>
          <div>
            <h2>{t("mirrorCoding.title")}</h2>
            <p>{t("mirrorCoding.description")}</p>
          </div>
        </div>
        <p className="mirrorcoding-status" role="status">
          {t(`mirrorCoding.${account.status === "reauthorize" ? "reauthorizeStatus" : account.status}`)}
        </p>
        {account.account ? <strong className="mirrorcoding-name">{account.account.displayName}</strong> : null}
        {account.authorizationExpiresAt ? <p>{t("mirrorCoding.expires")}: {date(account.authorizationExpiresAt)}</p> : null}
        <div className="mirrorcoding-actions">
          {account.status === "authorizing" ? (
            <Button disabled={busy} onClick={() => void run("cancel")}>{t("mirrorCoding.cancel")}</Button>
          ) : (
            <Button disabled={busy} onClick={() => void run("login")}>{t(connected ? "mirrorCoding.reauthorize" : "mirrorCoding.login")}</Button>
          )}
          {connected ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void run("login")}>{t("mirrorCoding.switchAccount")}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void run("logout")}>{t("mirrorCoding.logout")}</Button>
            </>
          ) : null}
        </div>
        {(error || account.error) ? (
          <p className="mirrorcoding-error" role="alert">
            {t(`mirrorCoding.${error ?? account.error}`, { defaultValue: t("mirrorCoding.requestFailed") })}
          </p>
        ) : null}
        {account.pendingRevocation ? (
          <div role="status">
            <p>{t("mirrorCoding.pendingRevocation")}</p>
            <Button variant="ghost" disabled={busy} onClick={() => void run("revoke")}>{t("mirrorCoding.retryRevocation")}</Button>
          </div>
        ) : null}
      </section>

      {connected ? (
        <section className="settings-card-block mirrorcoding-card">
          <div className="mirrorcoding-actions">
            <h3>{t("mirrorCoding.models", { count: modelCount })}</h3>
            <Button variant="ghost" disabled={busy || account.sync === "syncing"} onClick={() => void run("refresh")}>
              {t("mirrorCoding.refresh")}
            </Button>
          </div>
          <p role="status">
            {t(`mirrorCoding.${account.sync}`)}{account.syncedAt ? ` · ${date(account.syncedAt)}` : ""}
          </p>
          {account.catalog?.groups.map((group) => (
            <div key={group.id} className="mirrorcoding-group-summary">
              <div><strong>{group.name}</strong><p>{group.description}</p></div>
              <span>{group.dynamicBilling ? t("mirrorCoding.dynamic") : `${group.ratio}×`}</span>
              <span>{t("mirrorCoding.models", { count: group.models.length })}</span>
            </div>
          ))}
          {account.catalog?.groups.length === 0 ? <p>{t("mirrorCoding.empty")}</p> : null}
        </section>
      ) : null}

      {connected ? <MobileSyncSettings /> : null}

      {confirmation ? (
        <AccountDialog title={t("mirrorCoding.confirmTitle")} onCancel={() => setConfirmation(undefined)}>
          <p>{t("mirrorCoding.confirmDescription")}</p>
          <div className="mirrorcoding-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmation(undefined)}>{t("common.cancel")}</Button>
            <Button disabled={busy} onClick={() => void run(confirmation, true)}>{t("mirrorCoding.confirm")}</Button>
          </div>
        </AccountDialog>
      ) : null}
    </div>
  );
}
