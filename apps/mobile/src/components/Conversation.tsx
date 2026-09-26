import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, ChevronUp, LoaderCircle, Paperclip, Send, Settings2, Square, X } from "lucide-react";
import type { MobileController } from "../state/controller";
import { useMobileStore } from "../state/store";
import { buildTranscriptEntries } from "../state/transcript-view";
import { pickAttachments, type PickedAttachment } from "../services/attachments";
import { CompactionDivider, DelegationCard, Message } from "./Transcript";
import { Approval, Question } from "./PendingActions";
import { SessionConfigSheet } from "./SessionConfigSheet";

function TranscriptSkeleton() {
  return <div className="transcript-skeleton" aria-hidden="true">
    <span className="skeleton skeleton-bubble"/>
    <span className="skeleton skeleton-bubble wide"/>
    <span className="skeleton skeleton-bubble"/>
  </div>;
}

/** Queued prompts with per-row remove and "send now" (ADR 0265 promotion). */
function QueueBar({ controller }: { controller: MobileController }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const snapshot = useMobileStore(controller, (view) => view.snapshot);
  const connection = useMobileStore(controller, (view) => view.connection);
  const [open, setOpen] = useState(false);
  const queued = snapshot?.queuedTurns.filter((turn) => turn.status === "queued") ?? [];
  if (queued.length === 0) return null;
  const previews = new Map((snapshot?.queuedPrompts ?? []).map((entry) => [entry.turnId, entry.content]));
  const offline = connection !== "connected";
  return <div className="queue-bar">
    <button className="queue-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span>{t("queuedMessages")} · {queued.length}</span>
      {open ? <ChevronDown size={15}/> : <ChevronUp size={15}/>}
    </button>
    {open && <ul className="queue-list">{queued.map((turn) => <li key={turn.id}>
      <span className="queue-text">{previews.get(turn.id) || `#${turn.queuePosition ?? ""}`}</span>
      <span className="queue-actions">
        <button className="icon-button" aria-label={t("sendNow")} disabled={offline} onClick={() => void controller.prioritizeQueued(turn.id)}><Send size={15}/></button>
        <button className="icon-button" aria-label={t("removeQueued")} disabled={offline} onClick={() => void controller.cancelQueued(turn.id)}><X size={15}/></button>
      </span>
    </li>)}</ul>}
  </div>;
}

export const Conversation = memo(function Conversation({ controller }: { controller: MobileController }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const sessionId = useMobileStore(controller, (view) => view.selectedId) ?? "";
  const messages = useMobileStore(controller, (view) => view.messages);
  const snapshot = useMobileStore(controller, (view) => view.snapshot);
  const loading = useMobileStore(controller, (view) => view.loading);
  const busy = useMobileStore(controller, (view) => view.busy);
  const configuring = useMobileStore(controller, (view) => view.configuring);
  const connection = useMobileStore(controller, (view) => view.connection);
  const uncertainMessageId = useMobileStore(controller, (view) => view.uncertainMessageId);
  const notice = useMobileStore(controller, (view) => view.notice);
  const catalog = useMobileStore(controller, (view) => view.catalog);
  const [draft, setDraft] = useState(controller.drafts.get(sessionId) ?? "");
  const [files, setFiles] = useState<PickedAttachment[]>(controller.files.get(sessionId) ?? []);
  const [configPanel, setConfigPanel] = useState<"mode" | "model">();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scroll = useRef<HTMLDivElement>(null); const composerInput = useRef<HTMLTextAreaElement>(null); const stick = useRef(true);
  const topSentinel = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const session = snapshot?.session; const imageMode = session?.taskMode === "image";
  const imageRunning = snapshot?.imageJobs.some((job) => job.status === "running") ?? false;
  const running = Boolean(snapshot?.activeTurn) || imageRunning;
  const entries = useMemo(() => buildTranscriptEntries(messages, snapshot?.compactions ?? []), [messages, snapshot?.compactions]);
  useEffect(() => { if (notice === "deliveryConfirmed") { setDraft(controller.drafts.get(sessionId) ?? ""); setFiles(controller.files.get(sessionId) ?? []); } }, [controller, sessionId, notice]);
  useEffect(() => { if (stick.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [messages, snapshot?.pendingApprovals.length, snapshot?.pendingInputs.length]);
  // Keep the viewport anchored on the same message while older pages prepend.
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !anchor.current) return;
    element.scrollTop = element.scrollHeight - anchor.current.height + anchor.current.top;
    anchor.current = null;
  }, [messages]);
  useEffect(() => { const input = composerInput.current; if (!input) return; input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; }, [draft]);
  const loadOlder = useCallback(async () => {
    const element = scroll.current;
    if (!element || loadingOlder) return;
    setLoadingOlder(true);
    stick.current = false;
    anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    try { await controller.earlier(); } finally { setLoadingOlder(false); }
  }, [controller, loadingOlder]);
  // Reaching the top loads the previous page without a tap.
  useEffect(() => {
    const sentinel = topSentinel.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      if (observed.some((entry) => entry.isIntersecting) && snapshot?.hasMoreHistory && !loading && !loadingOlder) void loadOlder();
    }, { root: scroll.current, rootMargin: "120px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [snapshot?.hasMoreHistory, loading, loadingOlder, loadOlder]);
  const updateDraft = (text: string) => { setDraft(text); controller.drafts.set(sessionId, text); };
  const updateFiles = useCallback((next: PickedAttachment[]) => { setFiles(next); controller.files.set(sessionId, next); }, [controller, sessionId]);
  const reference = useCallback((file: PickedAttachment) => {
    setFiles((previous) => { const next = [...previous, file]; controller.files.set(sessionId, next); return next; });
  }, [controller, sessionId]);
  const submit = async (event: FormEvent) => { event.preventDefault(); const text = draft.trim(); if (!text && !files.length) return; const sent = await controller.send(text, files); if (sent) { updateDraft(""); updateFiles([]); stick.current = true; } };
  const modeLabel = imageMode ? t("imageGeneration") : t(session?.taskMode ?? "agent");
  const modelLabel = session?.modelId ? `${session.modelId}${session.groupName ? ` · ${session.groupName}` : ""}` : t("chooseModel");
  return <main className="conversation">
    <div className="conversation-controls"><button className="config-chip" onClick={() => setConfigPanel("mode")} disabled={!session || configuring}><Settings2 size={15}/>{modeLabel}<ChevronDown size={14}/></button><button className="config-chip model-chip" onClick={() => setConfigPanel("model")} disabled={!session || configuring}><span>{modelLabel}</span><ChevronDown size={14}/></button></div>
    <div className="transcript" ref={scroll} onScroll={() => { const element = scroll.current; if (element) stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
      <div ref={topSentinel} className="history-sentinel" aria-hidden="true"/>
      {snapshot?.hasMoreHistory && (loadingOlder
        ? <div className="load-older" role="status"><LoaderCircle size={15} className="spin"/></div>
        : <button className="load-older" onClick={() => void loadOlder()}>{t("older")}</button>)}
      {messages.length === 0 && (loading ? <TranscriptSkeleton/> : <div className="empty-state">{t("emptyHistory")}</div>)}
      {entries.map((entry) => entry.kind === "message"
        ? <Message key={entry.message.id} message={entry.message} controller={controller} reference={reference}/>
        : entry.kind === "delegation"
          ? <DelegationCard key={`delegation:${entry.id}`} id={entry.id} agentName={entry.agentName} running={entry.running} messages={entry.messages} controller={controller} reference={reference}/>
          : <CompactionDivider key={`compaction:${entry.id}`}/>)}
      {imageRunning && <div className="action-card">{t("imageGeneration")} · {t("working")}</div>}
      {snapshot?.pendingApprovals.map((request) => <Approval key={request.id} request={request} controller={controller} markdown={snapshot?.plans?.find((plan) => plan.id === request.id)?.markdown}/>)}
      {snapshot?.pendingInputs.map((request) => <Question key={request.id} request={request} controller={controller}/>)}
    </div>
    {!stick.current && messages.length > 0 && <button className="back-latest" onClick={() => { stick.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }}>{t("backToLatest")}</button>}
    <QueueBar controller={controller}/>
    <form className="composer" onSubmit={submit}>
      {uncertainMessageId && <div className="muted"><p>{t("pendingSend")}</p><button type="button" disabled={connection !== "connected"} onClick={() => void controller.allowRetry()}>{t("allowRetry")}</button></div>}
      {files.length > 0 && <div className="composer-attachments">{files.map((file) => <span key={file.id}>{file.name}<button type="button" className="icon-button" aria-label={t("removeAttachment")} onClick={() => updateFiles(files.filter((entry) => entry.id !== file.id))}><X size={14}/></button></span>)}</div>}
      <textarea ref={composerInput} aria-label={t(imageMode ? "imagePrompt" : "prompt")} placeholder={t(session?.capabilities.canPrompt === false ? "readOnly" : imageMode ? "imagePrompt" : "prompt")} value={draft} rows={1} onChange={(event) => updateDraft(event.target.value)} disabled={busy || Boolean(uncertainMessageId) || session?.capabilities.canPrompt === false}/>
      <div className="composer-actions"><button className="icon-button" type="button" aria-label={t("attach")} disabled={busy} onClick={() => void controller.action(async () => { const picked = await pickAttachments(Boolean(imageMode)); updateFiles([...files, ...picked]); })}><Paperclip size={19}/></button><span className="muted composer-mode">{t(running ? "working" : "inherited")}{snapshot?.queuedTurns.length ? ` · ${t("queued")} ${snapshot.queuedTurns.length}` : ""}</span>{running && <button type="button" className="icon-button stop-button" aria-label={t("stop")} disabled={connection !== "connected"} onClick={() => void controller.stop()}><Square size={16}/></button>}<button type="submit" className="send-button" aria-label={t("send")} disabled={busy || connection !== "connected" || session?.capabilities.canPrompt === false || (!draft.trim() && files.length === 0) || Boolean(uncertainMessageId) || imageRunning}><ArrowUp size={20}/></button></div>
    </form>
    <SessionConfigSheet open={Boolean(configPanel)} panel={configPanel ?? "mode"} close={() => setConfigPanel(undefined)} controller={controller} view={{ snapshot, catalog, configuring }}/>
  </main>;
});
