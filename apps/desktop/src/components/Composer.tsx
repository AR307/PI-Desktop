import { useTranscriptView } from "../hooks/use-transcript-view";
import { MessageQuotes } from "../features/chat/MessageQuotes";
import { useImageComposer } from "../features/images/useImageComposer";
import { ImageOptions } from "../features/images/ImageOptions";
import { useImageReference } from "../features/images/useImageReference";
import { isRemoteSession, sessionAllows } from "../lib/remote-session-safety";
import { inheritedSessionModelBinding } from "../lib/session-model";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  Mode,
  PermissionMode,
} from "@pi-desktop/shared";
import {
  initialThinkingLevelForBinding,
  initialThinkingLevelForUnmatchedModel,
  imageGenerationBindings,
  isImageGenerationModel,
  normalizeLargePasteThreshold,
} from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { latestTurnContextInspector } from "../lib/latest-turn-context";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { headAsk, queuedAskCount } from "../lib/pending-asks";
import type { QueuedPrompt } from "../lib/queued-prompts";
import { composerModelDisplayName, sameComposerModelId } from "../lib/composer-models";
import { newConversationModelBinding } from "../lib/session-model";
import { latestSessionInScope } from "../lib/session-scope";
import {
  resolveComposerThinkingProvider,
} from "../lib/session-thinking";
import { ComposerAutocomplete } from "./ComposerAutocomplete";
import { AskToolCard } from "./AskToolCard";
import { PlanApprovalBar } from "./PlanApprovalBar";
import { TodoDock } from "./TodoDock";
import { BackgroundTasksBar } from "./BackgroundTasksBar";
import {
  COMPOSER_MAX_VISIBLE_ROWS,
  COMPOSER_MIN_HEIGHT_PX,
  PLACEHOLDER_KEYS,
  cssPixels,
  isPermissionMode,
  isThinkingLevel,
  thinkingLevelForProvider,
  thinkingProviderForModel,
  type ComposerPrefill,
} from "../features/chat/composer/model";
import { editorSelectionRange } from "../features/chat/composer/editor";
import { useComposerAttachments } from "../features/chat/composer/hooks/useComposerAttachments";
import { useComposerCompletions } from "../features/chat/composer/hooks/useComposerCompletions";
import { useComposerDraft } from "../features/chat/composer/hooks/useComposerDraft";
import { useComposerInputHistory } from "../features/chat/composer/hooks/useComposerInputHistory";
import { usePluginComposerBridge } from "../features/chat/composer/hooks/usePluginComposerBridge";
import { useComposerSubmit } from "../features/chat/composer/hooks/useComposerSubmit";
import { useComposerTransforms } from "../features/chat/composer/hooks/useComposerTransforms";
import { ComposerInput } from "../features/chat/composer/ComposerInput";
import { useComposerModelMenu } from "../features/chat/composer/hooks/useComposerModelMenu";
import { useVoiceInput } from "../features/voice/useVoiceInput";
import { ComposerToolbar } from "../features/chat/composer/ComposerToolbar";
import { ComposerStatus } from "../features/chat/composer/ComposerStatus";

const EMPTY_QUEUED_PROMPTS: QueuedPrompt[] = [];

export {
  THINKING_LEVELS,
  thinkingLevelForProvider,
  thinkingProviderForModel,
  type ComposerPrefill,
} from "../features/chat/composer/model";

export function Composer({
  variant = "docked",
  prefill,
  sessionId: targetSessionId,
}: {
  variant?: "home" | "docked";
  prefill?: ComposerPrefill | null;
  sessionId?: string;
}) {
  const { t } = useTranslation();
  const globalSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionId = targetSessionId ?? globalSessionId;
  const sendPrompt = useAppStore((s) => s.sendPrompt);
  const steerPrompt = useAppStore((s) => s.steerPrompt);
  const removeQueue = useAppStore((s) => s.removeQueuedPrompt);
  const removeQueuedPrompt = (id: string) => removeQueue(id, activeSessionId);
  const moveQueue = useAppStore((s) => s.moveQueuedPrompt);
  const moveQueuedPrompt = (id: string, direction: "up" | "down") => moveQueue(id, direction, activeSessionId);
  const editQueue = useAppStore((s) => s.editQueuedPrompt);
  const editQueuedPrompt = (id: string) => editQueue(id, activeSessionId);
  const sendNow = useAppStore((s) => s.sendQueuedNow);
  const sendQueuedNow = (id: string) => sendNow(id, activeSessionId);
  const abortSession = useAppStore((s) => s.abort);
  const abort = () => abortSession(activeSessionId);
  const isRunning = useAppStore((s) => activeSessionId ? !!s.runningSessions[activeSessionId] : false);
  const planningState = useAppStore((s) =>
    activeSessionId ? s.planningStates[activeSessionId] : undefined,
  );
  const settings = useAppStore((s) => s.settings);
  const plugins = useAppStore((s) => s.plugins);
  const imageGenerationCandidates = useMemo(
    () => imageGenerationBindings(settings?.imageGenerationModels, settings?.imageGeneration),
    [settings?.imageGenerationModels, settings?.imageGeneration],
  );
  const sessions = useAppStore((s) => s.sessions);

  const activeSessionSummary = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const capabilitySession = activeSessionSummary ?? (activeSessionId?.startsWith("remote:") ? { id: activeSessionId } : undefined);
  const composerTransforms = useMemo(
    () =>
      (sessionAllows(capabilitySession, "canUseLocalTools") ? plugins : [])
        .filter((plugin) => plugin.enabled && plugin.status === "ready")
        .flatMap((plugin) => plugin.composerTransforms ?? []),
    [plugins, activeSessionSummary, activeSessionId],
  );
  const remoteSession = isRemoteSession(capabilitySession);
  const localToolsAllowed = sessionAllows(capabilitySession, "canUseLocalTools");
  const attachmentsAllowed = sessionAllows(capabilitySession, "canAttach");
  const promptAllowed = sessionAllows(capabilitySession, "canPrompt");
  const nativeSession = activeSessionSummary?.source === "pi-native";
  const nativeReadOnly =
    nativeSession && activeSessionSummary.capabilities?.canPrompt !== true;
  const nativeInputBlocked = nativeReadOnly || !promptAllowed || ((nativeSession || remoteSession) && isRunning);
  const localWorkspacePath = useAppStore((s) => s.workspace?.path ?? "");
  const workspacePath = remoteSession ? "" : activeSessionSummary?.sideChatWorkspacePath ?? activeSessionSummary?.projectPath ?? localWorkspacePath;
  const sessionMeta = useAppStore((s) => s.sessionMeta);
  const providers = useAppStore((s) => s.providers);
  const providerModels = useAppStore((s) => s.providerModels);
  const { messages: liveMessages } = useTranscriptView(activeSessionId ?? "");
  const sessionCompactions = useAppStore((s) =>
    activeSessionId ? s.sessionCompactions[activeSessionId] : undefined,
  );
  // One inspector in the composer toolbar, always the newest turn with usage.
  const composerContextUsage = useMemo(
    () =>
      latestTurnContextInspector(
        liveMessages,
        providerModels,
        providers,
        sessionCompactions,
      ),
    [liveMessages, providerModels, providers, sessionCompactions],
  );
  const configureSession = useAppStore((s) => s.configureActiveSession);
  const configureActiveSession = (config: Parameters<typeof configureSession>[0]) => configureSession(config, activeSessionId);
  const showToast = useAppStore((s) => s.showToast);
  const composerPrefill = useAppStore((s) => s.composerPrefill);
  const clearComposerPrefill = useAppStore((s) => s.clearComposerPrefill);
  const planCheckpoint = useAppStore((s) =>
    activeSessionId ? s.planCheckpoints[activeSessionId] : undefined,
  );
  const pendingAsk = useAppStore((s) =>
    headAsk(s.pendingAsks, activeSessionId),
  );
  const queuedAsks = useAppStore((s) =>
    queuedAskCount(s.pendingAsks, activeSessionId),
  );
  const queuedPrompts = useAppStore((s) =>
    activeSessionId
      ? s.queuedPrompts[activeSessionId] ?? EMPTY_QUEUED_PROMPTS
      : EMPTY_QUEUED_PROMPTS,
  );

  const [modeOpen, setModeOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const composerTransformInvalidateRef = useRef<() => void>(() => {});
  const composerShellRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const publishedDockHeightRef = useRef(-1);

  const invalidateComposerTransforms = () => {
    composerTransformInvalidateRef.current();
  };

  const draft = useComposerDraft({
    variant,
    activeSessionId,
    workspacePath,
    sessions,
    composerPrefill,
    clearComposerPrefill,
    prefill,
    t,
    invalidateComposerTransforms,
    inputBlocked: planCheckpoint?.status === "pending" || nativeInputBlocked,
  });
  const {
    ref,
    draftKey,
    referenceSessionId,
    value,
    setValue,
    valueRef,
    cursor,
    setCursor,
    composing,
    setComposing,
    inputFocused,
    setInputFocused,
    placeholderIndex,
    activeFileReferences,
    fileReferencesRef,
    applyEditorDraft,
    snapshotReferences,
    draftSnapshot,
    draftRevision,
    clearDraftForKey,
    restoreDraftForKey,
    persistDraft,
    commitEditorDom,
    readLiveDraft,
    insertNewlineInEditor,
    handleInput,
  } = draft;
  const inputHistory = useComposerInputHistory({
    draftKey,
    referenceSessionId,
    draft,
  });

  const approvalPending = planCheckpoint?.status === "pending";
  const largePasteThreshold = normalizeLargePasteThreshold(
    settings?.largePasteThreshold,
  );
  const attachments = useComposerAttachments({
    inputBlocked: approvalPending || nativeSession,
    attachmentsAllowed,
    activeSessionId,
    draftKey,
    largePasteThreshold,
    t,
    draft: {
      ref,
      valueRef,
      fileReferencesRef: draft.fileReferencesRef,
      applyEditorDraft,
      snapshotReferences,
      commitEditorDom,
    },
  });
  const {
    pasting,
    dropTargetActive,
    droppedDirectories,
    pickAndAttach,
    pasteClipboardFiles,
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    openDroppedFolderAsProject,
    insertDroppedDirectoryPaths,
    dismissDroppedDirectories,
  } = attachments;
  const executionActive = isActivePlanExecution(planCheckpoint);
  const runActive = isRunning || executionActive;
  const inputBlocked = approvalPending || pasting || nativeInputBlocked;
  const controlsBlocked = approvalPending || nativeSession || !sessionAllows(capabilitySession, "canConfigureModel");
  const sendBlocked = approvalPending || pasting || nativeInputBlocked;
  // Edit returns one queued row to the composer. The row is removed and its
  // captured draft becomes the input, so the input must be empty first: the
  // live read is the only current source (the draft cache is not per keystroke).
  const handleEditQueuedPrompt = (id: string) => {
    if (readLiveDraft().trim() || activeFileReferences.length || draft.quotes.length) {
      showToast(t("chat.editQueuedPromptBusy"), { variant: "info" });
      return;
    }
    editQueuedPrompt(id);
  };
  const placeholderKeys = PLACEHOLDER_KEYS[variant];
  const placeholderKey =
    placeholderKeys[placeholderIndex % placeholderKeys.length] ?? placeholderKeys[0];
  const placeholderText = t(placeholderKey);

  const textareaMetricsRef = useRef<{ lineHeight: number; verticalChrome: number } | null>(null);
  const appliedHeightRef = useRef<number | null>(null);
  const appliedOverflowRef = useRef<string | null>(null);
  useEffect(() => {
    textareaMetricsRef.current = null;
    appliedHeightRef.current = null;
    appliedOverflowRef.current = null;
  }, [variant]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let metrics = textareaMetricsRef.current;
    if (!metrics) {
      const style = window.getComputedStyle(el);
      metrics = {
        lineHeight: cssPixels(style.lineHeight) || COMPOSER_MIN_HEIGHT_PX,
        verticalChrome:
          cssPixels(style.paddingTop) +
          cssPixels(style.paddingBottom) +
          cssPixels(style.borderTopWidth) +
          cssPixels(style.borderBottomWidth),
      };
      textareaMetricsRef.current = metrics;
    }
    const maxHeight = Math.ceil(
      metrics.lineHeight * COMPOSER_MAX_VISIBLE_ROWS + metrics.verticalChrome,
    );
    const applied =
      appliedHeightRef.current !== null &&
      el.style.height === `${appliedHeightRef.current}px`
        ? appliedHeightRef.current
        : null;
    let content = applied === null ? -1 : el.scrollHeight;
    if (
      applied === null ||
      (content <= el.clientHeight && applied > COMPOSER_MIN_HEIGHT_PX)
    ) {
      el.style.height = "auto";
      content = el.scrollHeight;
    }
    const next = Math.max(COMPOSER_MIN_HEIGHT_PX, Math.min(content, maxHeight));
    const overflowY = content > maxHeight ? "auto" : "hidden";
    if (appliedHeightRef.current !== next || el.style.height !== `${next}px`) {
      el.style.height = `${next}px`;
      appliedHeightRef.current = next;
    }
    if (appliedOverflowRef.current !== overflowY) {
      el.style.overflowY = overflowY;
      appliedOverflowRef.current = overflowY;
    }
  }, [value]);


  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const draftConfiguration = useAppStore((s) => s.draftConfiguration);
  const mode: Mode = activeSession
    ? activeSession.mode
    : (draftConfiguration?.mode ?? settings?.defaultMode ?? "agent");
  const planningLive =
    isRunning &&
    planningState === "planning" &&
    (mode === "plan" || mode === "goal");
  // Permission mode (D115/D132): inherited sessions still resolve through the
  // global setting, but the composer presents only the effective mode.
  const globalPermissionMode: PermissionMode =
    settings?.defaultPermissionMode ?? "ask";
  const sessionPermissionMode: PermissionMode = activeSession
    ? isPermissionMode(activeSession.permissionMode)
      ? activeSession.permissionMode
      : "inherit"
    : isPermissionMode(draftConfiguration?.permissionMode)
      ? draftConfiguration.permissionMode
      : "inherit";
  const effectivePermissionMode: Exclude<PermissionMode, "inherit"> =
    sessionPermissionMode === "inherit"
      ? (globalPermissionMode as Exclude<PermissionMode, "inherit">)
      : sessionPermissionMode;
  const composerPermissionMode: Exclude<PermissionMode, "inherit"> =
    mode === "goal" ? "auto" : effectivePermissionMode;
  const recentModels = useAppStore((s) => s.recentModels);
  const selectedModel = remoteSession ? { providerId: activeSession?.providerId, modelId: activeSession?.modelId } : inheritedSessionModelBinding({
    draft: activeSession ?? draftConfiguration,
    settings,
    providers,
    recentModels,
  });
  const provider = providers.find(candidate => candidate.id === selectedModel.providerId);
  const modelId = selectedModel.modelId;
  const selectedModelCatalog = provider ? providerModels[provider.id] : undefined;
  const catalogThinkingProvider = thinkingProviderForModel(
    provider,
    modelId,
    selectedModelCatalog,
  );
  const thinkingProvider = resolveComposerThinkingProvider({
    provider,
    modelId,
    activeSession,
    catalogThinkingProvider,
  });
  const selectedBinding = provider?.models.find((candidate) =>
    sameComposerModelId(candidate.id, modelId ?? ""),
  );
  const selectedModelInfo = selectedModelCatalog?.find((candidate) =>
    sameComposerModelId(candidate.modelId, modelId ?? ""),
  );
  // A draft without a session starts at the selected model's stored default
  // thinking level, clamped onto that binding's enabled ladder.
  const draftThinkingLevel = selectedModelInfo?.catalogSource === "models.dev"
    ? initialThinkingLevelForBinding(
        selectedBinding,
        thinkingProvider?.supportedThinkingLevels,
      )
    : initialThinkingLevelForUnmatchedModel(
        selectedBinding,
        thinkingProvider?.supportedThinkingLevels,
      );
  const sessionThinkingLevel =
    activeSession?.thinkingLevel ??
    (!activeSession ? draftConfiguration?.thinkingLevel : undefined) ??
    draftThinkingLevel;
  const configuredThinkingLevel = isThinkingLevel(sessionThinkingLevel)
    ? sessionThinkingLevel
    : "off";
  const thinkingLevel = thinkingLevelForProvider(
    thinkingProvider,
    configuredThinkingLevel,
  );
  const thinkingLabel = thinkingLevel;
  const modelLabel = modelId
    ? composerModelDisplayName(provider, modelId)
    : t("chat.model");
  const image = useImageComposer(activeSessionId ?? undefined, mode, thinkingLevel, draft);
  useImageReference(activeSessionId ?? undefined, draft);
  const modelMenu = useComposerModelMenu({
    configureActiveSession,
    task: image.active ? "image" : "chat",
    imageSelection: image.config,
    onSelectImage: image.selectModel,
    mode,
    activeSessionId,
    provider,
    modelId,
    thinkingProvider,
    thinkingLevel,
    controlsBlocked: controlsBlocked || image.busy || image.running,
  });
  const modelReady = remoteSession ? promptAllowed : nativeSession
    ? activeSessionSummary.capabilities?.canPrompt === true
    : !!provider &&
      provider.enabled &&
      !!modelId &&
      !isImageGenerationModel(imageGenerationCandidates, provider.id, modelId) &&
      (provider.hasSecret || provider.authKind === "none" || provider.authKind === "mirrorcoding");
  const enterToSend = settings?.enterToSend ?? true;
  const hasDraftContent = Boolean(value.trim() || activeFileReferences.length || draft.quotes.length);

  useEffect(() => {
    if (!controlsBlocked) return;
    setModeOpen(false);
    setPermissionOpen(false);
  }, [controlsBlocked]);

  const composerTransformController = useComposerTransforms({
    transforms: composerTransforms,
    value,
    draftKey,
    activeSessionId,
    providerId: provider?.id,
    modelId,
    sendBlocked,
    activeFileReferences,
    draft: { ref, setValue, setCursor },
    showToast,
  });
  composerTransformInvalidateRef.current = composerTransformController.invalidate;

  const submitController = useComposerSubmit({
    value,
    draftKey,
    activeSessionId,
    modelReady,
    invalidateComposerTransforms,
    sendBlocked,
    localCommandsAllowed: localToolsAllowed,
    steeringAllowed: sessionAllows(capabilitySession, "canSteer"),
    pasting,
    activeFileReferences,
    t,
    sendPrompt,
    steerPrompt,
    showToast,
    recordHistory: inputHistory.record,
    draft: {
      ref,
      draftSnapshot,
      draftRevision,
      clearDraftForKey,
      restoreDraftForKey,
    },
  });
  const { submit: submitChat } = submitController;
  const submit = (steering?: boolean) => image.active ? image.submit() : submitChat(steering);

  // Both submit entry points (the composer's Enter and the toolbar's Send)
  // leave history browsing before the draft is cleared.
  const submitFromComposer = (steering?: boolean) => {
    inputHistory.exitBrowsing();
    return submit(steering);
  };

  // Keep the legacy listener for already-started or IPC-owned Dictation, but
  // the Composer no longer exposes a Dictation control or overlay.
  useVoiceInput({
    enabled: !targetSessionId && localToolsAllowed && import.meta.env.DEV && !!settings?.voice?.enabled,
    onTranscriptionComplete: (text) => {
      const current = readLiveDraft();
      if (!current.trim()) {
        applyEditorDraft(text, fileReferencesRef.current, text.length);
      } else {
        const next = current + " " + text;
        applyEditorDraft(next, fileReferencesRef.current, next.length);
      }
    },
  });
  const completions = useComposerCompletions({
    value,
    cursor,
    composing,
    enabled: !inputBlocked && localToolsAllowed,
    referenceSessionId,
    fileReferencesRef,
    applyEditorDraft,
    handleInput,
    invalidateComposerTransforms,
  });

  // Plugin draft and attachment actions reach this composer while it takes input.
  usePluginComposerBridge({ ...draft, inputBlocked, enabled: localToolsAllowed && !targetSessionId });

  // Keep the transcript's bottom reserve in sync with the composer's real
  // height (it grows with multi-line input) so the last message sits just
  // above the box instead of far below it.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    // Setting a custom property on documentElement invalidates style for the
    // whole document, so an unchanged dock height must not be republished.
    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h === publishedDockHeightRef.current) return;
      publishedDockHeightRef.current = h;
      (targetSessionId ? dockRef.current?.closest<HTMLElement>(".side-chat-pane") : document.documentElement)?.style.setProperty(
        "--composer-dock-height",
        `${h}px`,
      );
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant, targetSessionId]);

  return (
    <div
      ref={dockRef}
      className={`composer-dock composer-dock-${variant}`}
      data-composer-dock={variant}
      data-composer-session={activeSessionId ?? ""}
    >
      <div className="composer-stack">
        {activeSessionId && localToolsAllowed ? <TodoDock sessionId={activeSessionId} /> : null}
        <BackgroundTasksBar key={activeSessionId} sessionId={activeSessionId ?? undefined} />
        {planCheckpoint?.status === "pending" ? (
          <PlanApprovalBar proposal={planCheckpoint} />
        ) : null}
        {pendingAsk ? (
          <AskToolCard key={pendingAsk.requestId} request={pendingAsk} queued={queuedAsks} />
        ) : null}
        {nativeReadOnly ? (
          <div className="composer-status" role="status">
            Native Pi session is read-only: {activeSessionSummary?.readOnlyReason ?? "continuation unavailable"}.
          </div>
        ) : null}
        <ComposerStatus
          t={t}
          queuedPrompts={queuedPrompts}
          removeQueuedPrompt={removeQueuedPrompt}
          moveQueuedPrompt={moveQueuedPrompt}
          editQueuedPrompt={handleEditQueuedPrompt}
          sendQueuedNow={sendQueuedNow}
          approvalPending={approvalPending}
          droppedDirectories={droppedDirectories}
          openDroppedFolderAsProject={openDroppedFolderAsProject}
          insertDroppedDirectoryPaths={insertDroppedDirectoryPaths}
          dismissDroppedDirectories={dismissDroppedDirectories}
        />
        <div
          ref={composerShellRef}
          className={`composer-shell${inputBlocked ? " is-gated" : ""}${
            dropTargetActive ? " is-drop-target" : ""
          }`}
          onDragEnter={onComposerDragEnter}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
        >
          {inputFocused ? (
            <ComposerAutocomplete
              anchorRef={composerShellRef}
              ac={completions.ac}
              onAccept={completions.acceptCompletion}
            />
          ) : null}
          {image.active ? <ImageOptions capability={image.capability} options={image.config.options} references={activeFileReferences.length} disabled={image.busy || image.running} onChange={image.setOptions} /> : null}
          {image.running ? <div className="image-options-notice" role="status">{t("images.generating")} · {image.label}</div> : null}
          <MessageQuotes quotes={draft.quotes} onRemove={draft.removeQuote} />
          <ComposerInput
            imagePreview={draft.imagePreview}
            inputRef={ref}
            value={value}
            placeholderText={image.active ? t("images.prompt") : placeholderText}
            placeholderKey={`${variant}-${placeholderIndex}-${placeholderText}`}
            inputBlocked={inputBlocked || image.running || image.busy}
            pasting={pasting}
            enterToSend={enterToSend}
            runActive={runActive}
            composerAc={completions.ac}
            onPaste={pasteClipboardFiles}
            onAcceptCompletion={completions.acceptCompletion}
            onSubmit={(steering) => void submitFromComposer(steering)}
            onInsertNewline={insertNewlineInEditor}
            onInput={(source, caret) => {
              inputHistory.exitBrowsing();
              completions.handleInput(source, caret);
            }}
            onHistoryNavigate={inputHistory.navigate}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              draft.updateCursor(editorSelectionRange(event.currentTarget).start);
            }}
            // A dropped compositionend must not freeze the menu forever (#929).
            onSettledInput={() => draft.setComposing(false)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              setInputFocused(false);
              persistDraft();
            }}
          />
          <ComposerToolbar
            t={t}
            mode={mode}
            task={image.active ? "image" : "chat"}
            onModeChange={image.selectMode}
            modeBlocked={runActive || image.busy}
            planningLive={planningLive}
            providerId={provider?.id}
            modelId={modelId}
            thinkingLevel={thinkingLevel}
            composerPermissionMode={composerPermissionMode}
            modeOpen={modeOpen}
            setModeOpen={setModeOpen}
            permissionOpen={permissionOpen}
            setPermissionOpen={setPermissionOpen}
            controlsBlocked={controlsBlocked}
            localToolsAllowed={localToolsAllowed}
            globalComposerControlsAllowed={!targetSessionId}
            attachmentsAllowed={attachmentsAllowed}
            stopAllowed={sessionAllows(capabilitySession, "canStop")}
            pasting={pasting}
            pickAndAttach={pickAndAttach}
            configureActiveSession={configureActiveSession}
            showToast={showToast}
            modelMenu={modelMenu}
            modelLabel={image.active ? image.label : modelLabel}
            thinkingLabel={thinkingLabel}
            contextUsage={composerContextUsage ?? null}
            value={value}
            modelReady={image.active ? image.ready : modelReady}
            sendBlocked={sendBlocked || (image.active && (image.busy || image.running))}
            composerTransforms={composerTransforms}
            activeTransformKey={composerTransformController.activeTransformKey}
            undoTransform={composerTransformController.undo?.transform ?? null}
            runComposerTransform={composerTransformController.run}
            undoComposerTransform={composerTransformController.undoLast}
            runActive={runActive}
            hasDraftContent={hasDraftContent}
            abort={image.active ? image.abort : abort}
            submit={submitFromComposer}
            workSessionId={activeSessionId ?? undefined}
            workSessionLabel={activeSessionSummary?.title}
          />
        </div>
      </div>
    </div>
  );
}
