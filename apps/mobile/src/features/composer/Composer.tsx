import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, ChevronUp, Paperclip, Send, Square, X } from "lucide-react";
import type { MobileController } from "../../state/controller";
import { useMobileStore } from "../../state/store";
import { pickAttachments, type PickedAttachment } from "../../services/attachments";

/** Queued prompts with per-row remove and "send now" (ADR 0265 promotion). */
export function QueueBar({ controller }: { controller: MobileController }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const snapshot = useMobileStore(controller, (view) => view.snapshot);
  const connection = useMobileStore(controller, (view) => view.connection);
  const [open, setOpen] = useState(false);
  const queued = snapshot?.queuedTurns.filter((turn) => turn.status === "queued") ?? [];
  if (queued.length === 0) return null;
  const previews = new Map((snapshot?.queuedPrompts ?? []).map((entry) => [entry.turnId, entry.content]));
  const offline = connection !== "connected";
  return <div className="queue-bar">
    <button type="button" className="queue-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span>{t("queuedMessages")} · {queued.length}</span>
      {open ? <ChevronDown size={15}/> : <ChevronUp size={15}/>}
    </button>
    {open && <ul className="queue-list">{queued.map((turn) => <li key={turn.id}>
      <span className="queue-text">{previews.get(turn.id) || `#${turn.queuePosition ?? ""}`}</span>
      <span className="queue-actions">
        <button type="button" className="icon-button" aria-label={t("sendNow")} disabled={offline} onClick={() => void controller.prioritizeQueued(turn.id)}><Send size={15}/></button>
        <button type="button" className="icon-button" aria-label={t("removeQueued")} disabled={offline} onClick={() => void controller.cancelQueued(turn.id)}><X size={15}/></button>
      </span>
    </li>)}</ul>}
  </div>;
}

export function Composer({ controller, draft, setDraft, files, setFiles, onSent }: {
  controller: MobileController; draft: string; setDraft(text: string): void; files: PickedAttachment[]; setFiles(files: PickedAttachment[]): void; onSent(): void;
}) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const snapshot = useMobileStore(controller, (view) => view.snapshot);
  const busy = useMobileStore(controller, (view) => view.busy);
  const connection = useMobileStore(controller, (view) => view.connection);
  const uncertainMessageId = useMobileStore(controller, (view) => view.uncertainMessageId);
  const input = useRef<HTMLTextAreaElement>(null);
  const session = snapshot?.session;
  const imageMode = session?.taskMode === "image";
  const imageRunning = snapshot?.imageJobs.some((job) => job.status === "running") ?? false;
  const running = Boolean(snapshot?.activeTurn) || imageRunning;
  const readOnly = session?.capabilities.canPrompt === false;
  useEffect(() => { const element = input.current; if (!element) return; element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 160)}px`; }, [draft]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text && !files.length) return;
    if (await controller.send(text, files)) { setDraft(""); setFiles([]); onSent(); }
  };
  const status = [t(running ? "working" : "inherited"), snapshot?.queuedTurns.length ? `${t("queued")} ${snapshot.queuedTurns.length}` : ""].filter(Boolean).join(" · ");
  return <form className="composer" onSubmit={(event) => void submit(event)}>
    {uncertainMessageId && <div className="composer-notice" role="status"><p>{t("pendingSend")}</p><button type="button" disabled={connection !== "connected"} onClick={() => void controller.allowRetry()}>{t("allowRetry")}</button></div>}
    {files.length > 0 && <div className="composer-attachments">{files.map((file) => <span key={file.id}><span>{file.name}</span><button type="button" className="icon-button" aria-label={t("removeAttachment")} onClick={() => setFiles(files.filter((entry) => entry.id !== file.id))}><X size={14}/></button></span>)}</div>}
    <textarea ref={input} aria-label={t(imageMode ? "imagePrompt" : "prompt")} placeholder={t(readOnly ? "readOnly" : imageMode ? "imagePrompt" : "prompt")} value={draft} rows={1}
      onChange={(event) => setDraft(event.target.value)} disabled={busy || Boolean(uncertainMessageId) || readOnly}/>
    <div className="composer-actions">
      <button className="icon-button" type="button" aria-label={t("attach")} disabled={busy || readOnly} onClick={() => void controller.action(async () => { const picked = await pickAttachments(Boolean(imageMode)); setFiles([...files, ...picked]); })}><Paperclip size={19}/></button>
      <span className="composer-mode">{status}</span>
      {running && <button type="button" className="stop-button" aria-label={t("stop")} disabled={connection !== "connected"} onClick={() => void controller.stop()}><Square size={14} fill="currentColor"/></button>}
      <button type="submit" className="send-button" aria-label={t("send")} disabled={busy || connection !== "connected" || readOnly || (!draft.trim() && files.length === 0) || Boolean(uncertainMessageId) || imageRunning}><ArrowUp size={20}/></button>
    </div>
  </form>;
}
