import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MobilePairing, MobileSyncScopeInput } from "@pi-desktop/shared";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { AccountDialog } from "../account/AccountDialog";
import { useMirrorCoding } from "../account/state";
import { useMobileSync } from "./useMobileSync";
import "../account/account.css";
import "./mobile-sync.css";

export type MobilePairingTarget = { scope: MobileSyncScopeInput; label: string };

export function MobilePairingDialog({ target, existing, onClose }: {
  target: MobilePairingTarget;
  existing?: MobilePairing;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const account = useMirrorCoding((state) => state.account);
  const { state } = useMobileSync();
  const [pairing, setPairing] = useState(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [confirmLogin, setConfirmLogin] = useState(false);
  const [paired, setPaired] = useState(false);
  const [now, setNow] = useState(Date.now());
  const started = useRef(Boolean(existing));
  const mounted = useRef(true);
  const activePairing = useRef(existing);
  const observedPending = useRef(false);
  const previousGrants = useRef(new Set<string>());
  const connected = account?.status === "connected";
  const expired = Boolean(pairing && Date.parse(pairing.expiresAt) <= now);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pairing || !state) return;
    if (state.pairings.some((item) => item.id === pairing.id)) {
      observedPending.current = true;
      previousGrants.current = new Set(state.grants.map((grant) => grant.id));
    } else if (observedPending.current && state.grants.some((grant) =>
      !previousGrants.current.has(grant.id) && grant.scope.kind === pairing.scope.kind && grant.scope.id === pairing.scope.id)) {
      setPaired(true);
    }
  }, [pairing, state]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    setPaired(false);
    observedPending.current = false;
    try {
      if (activePairing.current) {
        await api.mobileSync.cancelPairing(activePairing.current.id);
        activePairing.current = undefined;
      }
      if (mounted.current) setPairing(undefined);
      const next = await api.mobileSync.createPairing(target.scope);
      if (!mounted.current) {
        await api.mobileSync.cancelPairing(next.id);
        return;
      }
      activePairing.current = next;
      setPairing(next);
      setNow(Date.now());
    } catch {
      if (mounted.current) setError("pairingFailed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [target.scope]);

  useEffect(() => {
    if (!connected || started.current) return;
    started.current = true;
    void generate();
  }, [connected, generate]);

  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (activePairing.current && !paired) await api.mobileSync.cancelPairing(activePairing.current.id);
      onClose();
    } catch { setError("cancelFailed"); }
    finally { if (mounted.current) setBusy(false); }
  };

  const login = async (confirmed = false) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.mirrorCodingLogin(confirmed);
      if (!mounted.current) return;
      if (result.confirmationRequired) { setConfirmLogin(true); return; }
      setConfirmLogin(false);
      if (result.state) useMirrorCoding.setState({ account: result.state });
    } catch { if (mounted.current) setError("loginFailed"); }
    finally { if (mounted.current) setBusy(false); }
  };

  const cancelLogin = async () => {
    setBusy(true);
    try {
      const next = await api.mirrorCodingCancel();
      if (mounted.current) useMirrorCoding.setState({ account: next });
    } catch { if (mounted.current) setError("loginFailed"); }
    finally { if (mounted.current) setBusy(false); }
  };

  return <AccountDialog title={t("mobileSync.title")} onCancel={() => void close()}>
    <div className="mobile-sync-dialog-body" data-testid="mobile-pairing-dialog">
      <div className="mobile-sync-scope"><span>{t(target.scope.kind === "project" ? "mobileSync.project" : "mobileSync.session")}</span><strong>{pairing?.scope.label ?? target.label}</strong></div>
      <p>{t(target.scope.kind === "project" ? "mobileSync.projectDescription" : "mobileSync.sessionDescription")}</p>
      {!connected ? <>
        <p>{t("mobileSync.loginRequired")}</p>
        {confirmLogin ? <><p>{t("mirrorCoding.confirmDescription")}</p><Button disabled={busy} onClick={() => void login(true)}>{t("mirrorCoding.confirm")}</Button></> :
          account?.status === "authorizing" ? <><p role="status">{t("mirrorCoding.authorizing")}</p><Button disabled={busy} onClick={() => void cancelLogin()}>{t("mirrorCoding.cancel")}</Button></> :
          <Button disabled={busy} onClick={() => void login()}>{t("mirrorCoding.login")}</Button>}
      </> : paired ? <p role="status" className="mobile-sync-success">{t("mobileSync.paired")}</p> : <>
        <p>{t("mobileSync.pairInstructions", { account: account.account?.display_name ?? "MirrorCoding" })}</p>
        {pairing && !expired ? <>
          <output className="mobile-sync-code" aria-label={t("mobileSync.code")} data-testid="mobile-pairing-code">{pairing.code}</output>
          <p className="mobile-sync-expiry">{t("mobileSync.expires", { time: new Date(pairing.expiresAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) })}</p>
          <Button variant="ghost" disabled={busy} onClick={() => void navigator.clipboard.writeText(pairing.code).then(() => setCopied(true)).catch(() => setError("copyFailed"))}>{t(copied ? "mobileSync.copied" : "mobileSync.copyCode")}</Button>
        </> : <p role="status">{t(expired ? "mobileSync.expired" : busy ? "mobileSync.creating" : "mobileSync.noCode")}</p>}
        {!busy && <Button variant="ghost" data-action="regenerate-mobile-pairing" onClick={() => void generate()}>{t(pairing ? "mobileSync.regenerate" : "mobileSync.retry")}</Button>}
      </>}
      {error && <p role="alert" className="mirrorcoding-error">{t(`mobileSync.${error}`)}</p>}
      <p className="mobile-sync-note">{t("mobileSync.onlineNote")}</p>
      <div className="mirrorcoding-actions"><Button variant="ghost" disabled={busy} data-action="close-mobile-pairing" onClick={() => void close()}>{t(pairing && !paired ? "mobileSync.cancelPairing" : "common.close")}</Button></div>
    </div>
  </AccountDialog>;
}
