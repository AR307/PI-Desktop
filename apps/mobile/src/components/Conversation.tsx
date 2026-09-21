import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import type { MobileController, MobileView } from "../state/controller";
import { pickAttachments, type PickedAttachment } from "../services/attachments";
import { Message } from "./Transcript";
import { Approval, Question } from "./PendingActions";

export function Conversation({ controller, view }: { controller: MobileController; view: MobileView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const sessionId = view.selectedId ?? "";
  const [draft, setDraft] = useState(controller.drafts.get(sessionId) ?? "");
  const [files, setFiles] = useState<PickedAttachment[]>(controller.files.get(sessionId) ?? []);
  const scroll = useRef<HTMLDivElement>(null); const stick = useRef(true);
  const session = view.snapshot?.session; const imageMode = session?.taskMode === "image";
  const imageRunning = view.snapshot?.imageJobs.some((job) => job.status === "running") ?? false;
  const running = Boolean(view.snapshot?.activeTurn) || imageRunning;
  useEffect(() => { if (view.notice === "deliveryConfirmed") { setDraft(controller.drafts.get(sessionId) ?? ""); setFiles(controller.files.get(sessionId) ?? []); } }, [controller, sessionId, view.notice]);
  useEffect(() => { if (stick.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [view.messages, view.snapshot?.pendingApprovals.length, view.snapshot?.pendingInputs.length]);
  const updateDraft = (text: string) => { setDraft(text); controller.drafts.set(sessionId, text); };
  const updateFiles = (next: PickedAttachment[]) => { setFiles(next); controller.files.set(sessionId, next); };
  const reference = (file: PickedAttachment) => updateFiles([...files, file]);
  const submit = async (event: FormEvent) => { event.preventDefault(); const text = draft.trim(); if (!text && !files.length) return; const sent = await controller.send(text, files); if (sent) { updateDraft(""); updateFiles([]); stick.current = true; } };
  return <main className="conversation">
    <div className="session-meta"><strong>{session?.title}</strong><span>{session?.modelId}{session?.groupName ? ` · ${session.groupName}` : ""} · {t(imageMode ? "imageGeneration" : session?.taskMode ?? "agent")}</span></div>
    <div className="transcript" ref={scroll} onScroll={() => { const element = scroll.current; if (element) stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
      {view.snapshot?.hasMoreHistory && <button className="load-older" onClick={() => { stick.current = false; void controller.earlier(); }}>{t("older")}</button>}
      {view.messages.length === 0 && <div className="empty-state">{t(view.loading ? "working" : "emptyHistory")}</div>}
      {view.messages.map((message) => <Message key={message.id} message={message} controller={controller} reference={reference}/>)}
      {imageRunning && <div className="action-card">{t("imageGeneration")} · {t("working")}</div>}
      {view.snapshot?.pendingApprovals.map((request) => <Approval key={request.id} request={request} controller={controller} markdown={view.snapshot?.plans?.find((plan) => plan.id === request.id)?.markdown}/>)}
      {view.snapshot?.pendingInputs.map((request) => <Question key={request.id} request={request} controller={controller}/>)}
    </div>
    <form className="composer" onSubmit={submit}>
      {view.uncertainMessageId && <div className="muted"><p>{t("pendingSend")}</p><button type="button" disabled={view.connection !== "connected"} onClick={() => void controller.allowRetry()}>{t("allowRetry")}</button></div>}
      {files.length > 0 && <div className="composer-attachments">{files.map((file) => <span key={file.id}>{file.name}<button type="button" className="icon-button" aria-label={t("removeAttachment")} onClick={() => updateFiles(files.filter((entry) => entry.id !== file.id))}><X size={14}/></button></span>)}</div>}
      <textarea aria-label={t(imageMode ? "imagePrompt" : "prompt")} placeholder={t(session?.capabilities.canPrompt === false ? "readOnly" : imageMode ? "imagePrompt" : "prompt")} value={draft} rows={3} onChange={(event) => updateDraft(event.target.value)} disabled={view.busy || Boolean(view.uncertainMessageId) || session?.capabilities.canPrompt === false}/>
      <div className="composer-actions"><button className="icon-button" type="button" aria-label={t("attach")} disabled={view.busy} onClick={() => void controller.action(async () => { const picked = await pickAttachments(Boolean(imageMode)); updateFiles([...files, ...picked]); })}><Paperclip size={19}/></button><span className="muted composer-mode">{t(running ? "working" : "inherited")}{view.snapshot?.queuedTurns.length ? ` · ${t("queued")} ${view.snapshot.queuedTurns.length}` : ""}</span>{running && <button type="button" className="icon-button stop-button" aria-label={t("stop")} disabled={view.connection !== "connected"} onClick={() => void controller.stop()}><Square size={16}/></button>}<button type="submit" className="send-button" aria-label={t("send")} disabled={view.busy || view.connection !== "connected" || session?.capabilities.canPrompt === false || (!draft.trim() && files.length === 0) || Boolean(view.uncertainMessageId) || imageRunning}><ArrowUp size={20}/></button></div>
    </form>
  </main>;
}
