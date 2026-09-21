import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Folder, MessageSquare, Monitor, Plus, RefreshCw, Unlink } from "lucide-react";
import type { MobileController, MobileView } from "../state/controller";
import { useBackDismiss } from "./useBackDismiss";

export function Home({ controller, view }: { controller: MobileController; view: MobileView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [pairing, setPairing] = useState(false); const [code, setCode] = useState(""); const [revokeId, setRevokeId] = useState<string>();
  useBackDismiss(pairing || Boolean(revokeId), () => { setPairing(false); setRevokeId(undefined); });
  const submit = async (event: FormEvent) => { event.preventDefault(); await controller.pair(code); if (!controller.getSnapshot().error) { setCode(""); setPairing(false); } };
  return <main className="work-list">
    <div className="section-title"><h1>{t("projects")}</h1><button className="icon-button" aria-label={t("refresh")} onClick={() => void controller.action(() => controller.refreshGrants())}><RefreshCw size={18}/></button></div>
    <p className="muted">{t("subtitle")}</p>
    {view.grants.length === 0 && <div className="empty-state"><Monitor size={36}/><h2>{t("empty")}</h2><p>{t("emptyHint")}</p></div>}
    <div className="grant-list">{view.grants.map((grant) => {
      const desktop = view.devices.find((device) => device.deviceId === grant.desktopDeviceId);
      return <article className="grant-card" key={grant.id}>
        <button className="grant-open" onClick={() => void controller.openGrant(grant)}>
          <span className="tile-icon">{grant.scope.kind === "project" ? <Folder size={22}/> : <MessageSquare size={22}/>}</span>
          <span className="grant-content"><strong>{grant.scope.label}</strong><span className="muted"><span className={`status-dot ${desktop?.online ? "online" : ""}`}/>{desktop?.name ?? t("devices")} · {t(desktop?.online ? "online" : "offline")}</span></span><ChevronRight size={18}/>
        </button>
        <button className="icon-button grant-remove" aria-label={t("revoke")} onClick={() => setRevokeId(grant.id)}><Unlink size={15}/></button>
      </article>;
    })}</div>
    <button className="pair-button" onClick={() => setPairing(true)}><Plus size={18}/>{t("pair")}</button>
    {pairing && <div className="modal-scrim"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="pair-title"><h2 id="pair-title">{t("pair")}</h2><p className="muted">{t("pairHint")}</p><form onSubmit={submit}><label>{t("pairCode")}<input autoFocus inputMode="numeric" autoComplete="off" maxLength={8} pattern="[0-9]{8}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}/></label><div className="button-row"><button type="button" onClick={() => setPairing(false)}>{t("cancel")}</button><button className="primary" disabled={view.busy || code.length !== 8}>{t(view.busy ? "working" : "pairSubmit")}</button></div></form></section></div>}
    {revokeId && <div className="modal-scrim"><section className="dialog" role="alertdialog" aria-modal="true"><h2>{t("revoke")}</h2><p>{t("revokeConfirm")}</p><div className="button-row"><button onClick={() => setRevokeId(undefined)}>{t("no")}</button><button className="danger" onClick={() => { const grant = view.grants.find((entry) => entry.id === revokeId); if (grant) void controller.revoke(grant); setRevokeId(undefined); }}>{t("yes")}</button></div></section></div>}
  </main>;
}

export function Sessions({ controller, view }: { controller: MobileController; view: MobileView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  return <main className="work-list"><h1>{view.grant?.scope.label}</h1><p className="muted">{t("conversations")}</p>
    {view.sessions.map((session) => <button className="session-card" key={session.id} onClick={() => void controller.selectSession(session.id)}><MessageSquare size={20}/><span><strong>{session.title}</strong><small>{session.modelId} · {t(session.taskMode === "image" ? "imageGeneration" : session.taskMode)}</small></span>{session.activeTurnId ? <span className="status-dot online"/> : <ChevronRight size={17}/>}</button>)}
    {view.sessions.length === 0 && <p className="empty-state">{t(view.connection === "connected" ? "noConversations" : "offlineHint")}</p>}
  </main>;
}
