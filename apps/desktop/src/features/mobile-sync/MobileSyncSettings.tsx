import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Smartphone } from "lucide-react";
import type { MobilePairing, MobileSyncScope } from "@pi-desktop/shared";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { MobilePairingDialog, type MobilePairingTarget } from "./MobilePairingDialog";
import { useMobileSync } from "./useMobileSync";
import "./mobile-sync.css";

function pairingTarget(scope: MobileSyncScope): MobilePairingTarget {
  return { label: scope.label, scope: scope.kind === "session"
    ? { kind: "session", sessionId: scope.id }
    : { kind: "project", projectId: scope.id } };
}

export function MobileSyncSettings() {
  const { t, i18n } = useTranslation();
  const { state, error: loadError, refreshing, refresh } = useMobileSync(true);
  const [pairing, setPairing] = useState<{ target: MobilePairingTarget; existing?: MobilePairing }>();
  const [confirmRevoke, setConfirmRevoke] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const revoke = async (id: string) => {
    setBusy(id);
    setError(undefined);
    try {
      await api.mobileSync.revoke(id);
      setConfirmRevoke(undefined);
      await refresh();
    } catch { setError("revokeFailed"); }
    finally { setBusy(undefined); }
  };

  return <section className="settings-card-block mirrorcoding-card" data-testid="mobile-sync-settings">
    <div className="mobile-sync-heading"><Smartphone size={20} aria-hidden /><h3>{t("mobileSync.manage")}</h3><Button variant="ghost" disabled={refreshing || Boolean(busy)} onClick={() => void refresh()}>{t("mobileSync.refresh")}</Button></div>
    <p>{t("mobileSync.manageDescription")}</p>
    {state ? <p className="mobile-sync-status" data-status={state.status} role="status">{t(`mobileSync.status.${state.status}`)}</p> : !loadError && <p role="status">{t("common.loading")}</p>}
    {(error || loadError || state?.error) && <p className="mirrorcoding-error" role="alert">{t(`mobileSync.${error ?? loadError ?? (state?.error === "mobile_revoke_pending" ? "revokePending" : "requestFailed")}`)}</p>}
    {state?.pairings.length ? <ul className="mobile-sync-grants">{state.pairings.map((item) => <li className="mobile-sync-grant" key={item.id}>
      <strong>{item.scope.label}</strong><p>{t("mobileSync.pendingPairing")}</p>
      <div className="mirrorcoding-actions"><Button variant="ghost" onClick={() => setPairing({ target: pairingTarget(item.scope), existing: item })}>{t("mobileSync.showCode")}</Button></div>
    </li>)}</ul> : null}
    {state?.grants.length ? <ul className="mobile-sync-grants">{state.grants.map((grant) => <li className="mobile-sync-grant" key={grant.id} data-grant-id={grant.id}>
      <strong>{grant.mobileDeviceName}</strong><span>{t(grant.scope.kind === "project" ? "mobileSync.project" : "mobileSync.session")}: {grant.scope.label}</span>
      <p>{t("mobileSync.pairedAt", { time: new Date(grant.createdAt).toLocaleString(i18n.language) })}</p>
      {confirmRevoke === grant.id ? <div className="mobile-sync-revoke-confirm">
        <p>{t("mobileSync.revokeDescription")}</p><div className="mirrorcoding-actions">
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setConfirmRevoke(undefined)}>{t("common.cancel")}</Button>
          <Button disabled={Boolean(busy)} data-action="confirm-mobile-revoke" onClick={() => void revoke(grant.id)}>{t("mobileSync.revoke")}</Button>
        </div>
      </div> : <div className="mirrorcoding-actions">
        <Button variant="ghost" disabled={Boolean(busy)} data-action="add-mobile-device" onClick={() => setPairing({ target: pairingTarget(grant.scope) })}>{t("mobileSync.addDevice")}</Button>
        <Button variant="ghost" disabled={Boolean(busy)} data-action="revoke-mobile-grant" onClick={() => setConfirmRevoke(grant.id)}>{t("mobileSync.revoke")}</Button>
      </div>}
    </li>)}</ul> : state && <p>{t("mobileSync.empty")}</p>}
    <p className="mobile-sync-note">{t("mobileSync.onlineNote")}</p>
    {pairing && <MobilePairingDialog target={pairing.target} existing={pairing.existing} onClose={() => setPairing(undefined)} />}
  </section>;
}
