import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ChevronDown, LoaderCircle, RotateCw, Settings2 } from "lucide-react";
import type { MobileController } from "../state/controller";
import type { DesktopDirectory } from "../state/directories";
import { useMobileStore } from "../state/store";
import { buildTranscriptEntries } from "../state/transcript-view";
import type { PickedAttachment } from "../services/attachments";
import { CompactionDivider, DelegationCard, Message } from "../features/transcript/Transcript";
import { HistorySyncNotice } from "../features/transcript/HistorySyncNotice";
import { PendingDock } from "../features/actions/PendingActions";
import { Composer, QueueBar } from "../features/composer/Composer";
import { SessionConfigSheet } from "../features/session-config/SessionConfigSheet";

/** Distance from the bottom that still counts as following the live tail. */
const FOLLOW_THRESHOLD_PX = 96;
const NO_MESSAGES: never[] = [];

function TranscriptSkeleton() {
  return <div className="transcript-skeleton" aria-hidden="true">
    <span className="skeleton skeleton-bubble wide"/>
    <span className="skeleton skeleton-bubble"/>
    <span className="skeleton skeleton-bubble wide"/>
  </div>;
}

export function ConversationScreen({ controller, desktopId, sessionId, directory, onBack, className = "" }: {
  controller: MobileController; desktopId: string; sessionId: string; directory?: DesktopDirectory; onBack(): void; className?: string;
}) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const selectedId = useMobileStore(controller, (view) => view.selectedId);
  const currentDesktop = useMobileStore(controller, (view) => view.desktopId);
  const ready = selectedId === sessionId && currentDesktop === desktopId;
  const messages = useMobileStore(controller, (view) => view.messages);
  const snapshot = useMobileStore(controller, (view) => view.snapshot);
  const loading = useMobileStore(controller, (view) => view.loading);
  const configuring = useMobileStore(controller, (view) => view.configuring);
  const connection = useMobileStore(controller, (view) => view.connection);
  const catalog = useMobileStore(controller, (view) => view.catalog);
  const syncError = useMobileStore(controller, (view) => view.syncError);
  const notice = useMobileStore(controller, (view) => view.notice);
  const draftKey = controller.draftKey(sessionId);
  const [draft, setDraftState] = useState(controller.drafts.get(draftKey) ?? "");
  const [files, setFilesState] = useState<PickedAttachment[]>(controller.files.get(draftKey) ?? []);
  const [configPanel, setConfigPanel] = useState<"mode" | "model">();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [following, setFollowing] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const frame = useRef<number>(undefined);

  const listed = directory?.sessions.find((session) => session.id === sessionId);
  const session = ready ? snapshot?.session : undefined;
  const title = session?.title || listed?.title || t("untitledSession");
  const shown = ready ? messages : NO_MESSAGES;
  const entries = useMemo(() => buildTranscriptEntries(shown, ready ? snapshot?.compactions ?? NO_MESSAGES : NO_MESSAGES), [shown, ready, snapshot?.compactions]);
  const imageMode = session?.taskMode === "image";
  const imageRunning = ready && (snapshot?.imageJobs.some((job) => job.status === "running") ?? false);
  const approvals = ready ? snapshot?.pendingApprovals ?? [] : [];
  const inputs = ready ? snapshot?.pendingInputs ?? [] : [];

  const setDraft = useCallback((text: string) => { setDraftState(text); controller.drafts.set(draftKey, text); }, [controller, draftKey]);
  const setFiles = useCallback((next: PickedAttachment[]) => { setFilesState(next); controller.files.set(draftKey, next); }, [controller, draftKey]);
  const reference = useCallback((file: PickedAttachment) => {
    setFilesState((previous) => { const next = [...previous, file]; controller.files.set(draftKey, next); return next; });
  }, [controller, draftKey]);
  useEffect(() => { if (notice === "deliveryConfirmed") { setDraftState(controller.drafts.get(draftKey) ?? ""); setFilesState(controller.files.get(draftKey) ?? []); } }, [controller, draftKey, notice]);

  const scrollToEnd = (smooth = false) => { const element = scroll.current; if (element) element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" }); };
  // Follow the live tail only while the reader is already at it.
  useEffect(() => { if (follow.current) scrollToEnd(); }, [shown, approvals.length, inputs.length]);
  // Keep the viewport anchored on the same message while older pages prepend.
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !anchor.current) return;
    element.scrollTop = element.scrollHeight - anchor.current.height + anchor.current.top;
    anchor.current = null;
  }, [shown]);
  const onScroll = () => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const element = scroll.current;
      if (!element) return;
      const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
      follow.current = atEnd;
      setFollowing(atEnd);
    });
  };
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  const loadOlder = useCallback(async () => {
    const element = scroll.current;
    if (!element || loadingOlder || !controller.canLoadEarlier()) return;
    setLoadingOlder(true);
    follow.current = false;
    anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    try { await controller.earlier(); } finally { setLoadingOlder(false); }
  }, [controller, loadingOlder]);
  // Reaching the top loads the previous page without a tap.
  useEffect(() => {
    const sentinel = topSentinel.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((observed) => {
      if (observed.some((entry) => entry.isIntersecting) && snapshot?.hasMoreHistory && !loading && !loadingOlder && ready) void loadOlder();
    }, { root: scroll.current, rootMargin: "160px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [snapshot?.hasMoreHistory, loading, loadingOlder, loadOlder, ready]);

  const modeLabel = imageMode ? t("imageGeneration") : t(session?.taskMode ?? "agent");
  const modelLabel = session?.modelId ? `${session.modelId}${session.groupName ? ` · ${session.groupName}` : ""}` : t("chooseModel");
  const connectionLabel = t(connection === "connected" ? "statusOnline" : connection === "connecting" ? "connecting" : connection === "reconnecting" ? "reconnecting" : "statusOffline");
  const offline = ready && connection !== "connected";

  return <section className={`conversation ${className}`} aria-label={title}>
    <header className="conversation-header">
      <button type="button" className="icon-button" aria-label={t("back")} onClick={onBack}><ArrowLeft size={22}/></button>
      <div className="conversation-heading">
        <strong>{title}</strong>
        <small className="muted"><span className={`dot ${connection === "connected" ? "online" : connection === "connecting" || connection === "reconnecting" ? "connecting" : ""}`}/>{directory?.device.name ?? t("unavailable")} · {connectionLabel}</small>
      </div>
    </header>
    {offline && <div className="connection-strip" role="status">{connectionLabel}{connection === "error" && <button type="button" onClick={() => void controller.reconnect(desktopId)}><RotateCw size={12}/>{t("retry")}</button>}</div>}
    {ready && syncError && <HistorySyncNotice error={syncError} connected={connection === "connected"} retry={() => controller.retryHistorySync()}/>}
    <div className="conversation-controls">
      <button type="button" className="config-chip" onClick={() => setConfigPanel("mode")} disabled={!session || configuring}><Settings2 size={14}/>{modeLabel}<ChevronDown size={13}/></button>
      <button type="button" className="config-chip model-chip" onClick={() => setConfigPanel("model")} disabled={!session || configuring}>
        <span>{modelLabel}{session?.configuration?.next.ultra && session?.taskMode !== "image" ? " · Ultra" : ""}</span><ChevronDown size={13}/>
      </button>
    </div>
    <div className="transcript" ref={scroll} onScroll={onScroll}>
      <div ref={topSentinel} className="history-sentinel" aria-hidden="true"/>
      {ready && snapshot?.hasMoreHistory && (loadingOlder
        ? <div className="load-older" role="status"><LoaderCircle size={15} className="spin"/></div>
        : <button type="button" className="load-older" onClick={() => void loadOlder()}>{t("older")}</button>)}
      {shown.length === 0 && (loading || !ready ? <TranscriptSkeleton/> : <div className="empty-state"><p>{t("emptyHistory")}</p></div>)}
      {entries.map((entry) => entry.kind === "message"
        ? <Message key={entry.message.id} message={entry.message} grouped={entry.grouped} controller={controller} reference={reference}/>
        : entry.kind === "delegation"
          ? <DelegationCard key={`delegation:${entry.id}`} id={entry.id} agentName={entry.agentName} configuration={entry.configuration} running={entry.running} fast={entry.fast} messages={entry.messages} controller={controller} reference={reference}/>
          : <CompactionDivider key={`compaction:${entry.id}`}/>)}
      {imageRunning && <div className="action-card inline-status"><LoaderCircle size={15} className="spin"/> {t("imageGeneration")} · {t("working")}</div>}
    </div>
    <div className="conversation-footer">
      {!following && shown.length > 0 && <button type="button" className="back-latest" onClick={() => { follow.current = true; setFollowing(true); scrollToEnd(true); }}><ArrowDown size={14}/>{t("backToLatest")}</button>}
      <PendingDock controller={controller} approvals={approvals} inputs={inputs} plans={snapshot?.plans}/>
      <QueueBar controller={controller}/>
      <Composer controller={controller} draft={draft} setDraft={setDraft} files={files} setFiles={setFiles} onSent={() => { follow.current = true; setFollowing(true); }}/>
    </div>
    <SessionConfigSheet open={Boolean(configPanel)} panel={configPanel ?? "mode"} close={() => setConfigPanel(undefined)} controller={controller} view={{ snapshot, catalog, configuring }}/>
  </section>;
}
