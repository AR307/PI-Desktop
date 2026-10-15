import type { MobileSessionConfigureInput, MobileSessionSnapshot, MobileSessionState, RacpApprovalDecision, RacpEventEnvelope, UiMessage } from "@pi-desktop/shared";
import { canContinueResponse } from "@pi-desktop/shared";
import type { MobileRelay } from "../services/relay";
import { type PickedAttachment, downloadAttachment, uploadAttachment } from "../services/attachments";
import { createTranscriptCache, type TranscriptCache } from "../services/transcript-cache";
import { cacheAttachment, readAttachment } from "../services/attachment-cache";
import { createFrameScheduler, type FrameScheduler } from "./frame-scheduler";
import { MobileHistory } from "./history";
import { applyTranscriptEvent, itemMessage, mergeMessages, snapshotMessages } from "./transcript";
import type { MobileView } from "./view";

/** What the open conversation needs from the app controller. */
export type ConversationHost = {
  view(): MobileView;
  patch(patch: Partial<MobileView>): void;
  /** A user-visible operation: clears the previous message and reports failures. */
  action(operation: () => Promise<void>): Promise<void>;
  background(operation: () => Promise<void>): Promise<void>;
  report(error: unknown): void;
  accountId(): string | undefined;
  relay(desktopId: string): MobileRelay | undefined;
};

export type ConversationOptions = { cache?: TranscriptCache; scheduler?: FrameScheduler; persistDelayMs?: number };

const CACHE_WRITE_DELAY_MS = 800;

/**
 * The selected conversation: cached-first attach, coalesced live events,
 * durable history reconciliation, cache writes and the session actions.
 * Uncertain mutations are never replayed automatically.
 */
export class MobileConversation {
  private boundRelay?: MobileRelay;
  private history?: MobileHistory;
  private syncingHistory = false;
  private selection = 0;
  private connectingEvents?: RacpEventEnvelope[];
  private stateJob?: Promise<void>;
  private stateAgain = false;
  private cacheTimer?: ReturnType<typeof setTimeout>;
  private frameEvents: RacpEventEnvelope[] = [];
  /** Rows changed or superseded in memory since the last committed cache write. */
  private changed = new Set<string>();
  private removed = new Set<string>();
  private readonly scheduler: FrameScheduler;
  private readonly persistDelayMs: number;
  private readonly uncertain = new Map<string, { messageId: string; keepDraft: boolean }>();
  readonly cache: TranscriptCache;
  readonly drafts = new Map<string, string>();
  readonly files = new Map<string, PickedAttachment[]>();

  constructor(private readonly host: ConversationHost, options: ConversationOptions = {}) {
    this.cache = options.cache ?? createTranscriptCache();
    this.scheduler = options.scheduler ?? createFrameScheduler();
    this.persistDelayMs = options.persistDelayMs ?? CACHE_WRITE_DELAY_MS;
  }
  get relay() { return this.boundRelay; }
  /** The desktop relay that subsequent session operations use. */
  bind(relay: MobileRelay | undefined) { this.boundRelay = relay; }
  draftKey(sessionId = this.host.view().selectedId ?? "") { return JSON.stringify([this.host.accountId(), this.host.view().desktopId, sessionId]); }
  clearDrafts() { this.drafts.clear(); this.files.clear(); this.uncertain.clear(); }
  private view() { return this.host.view(); }
  private patch(patch: Partial<MobileView>) { this.host.patch(patch); }

  async select(sessionId: string) {
    await this.flushCache();
    await this.history?.close();
    const desktopDeviceId = this.view().desktopId; const accountId = this.host.accountId();
    if (!desktopDeviceId || !accountId) return;
    const relay = this.host.relay(desktopDeviceId);
    this.boundRelay = relay;
    const selection = ++this.selection;
    const valid = () => selection === this.selection && desktopDeviceId === this.view().desktopId;
    this.clearFrameEvents();
    this.changed.clear(); this.removed.clear();
    this.connectingEvents = [];
    const history = new MobileHistory({ accountId, desktopDeviceId, sessionId }, this.cache);
    this.history = history;
    this.patch({ selectedId: sessionId, snapshot: undefined, catalog: undefined, messages: [], syncError: undefined, loading: true, uncertainMessageId: this.uncertain.get(this.draftKey(sessionId))?.messageId });
    await this.host.action(async () => {
      const cached = await history.read();
      if (!valid()) return;
      if (cached.entry) this.patch({
        messages: cached.messages,
        snapshot: { ...cached.entry.snapshot, hasMoreHistory: cached.hasOlderCached || cached.entry.hasMoreHistory },
        loading: false,
      });
      if (!relay || relay.client.state !== "connected") return;
      const result = await relay.attach(sessionId, cached.entry?.cursor);
      if (!valid()) return;
      if (result.kind === "state") {
        await history.run(async () => {
          if (!valid()) return;
          this.acceptState(result.state, { restoreActive: true });
          await this.reconcileHistory(history, relay, valid);
        });
      } else {
        await history.initialize(result.snapshot);
        if (!valid()) return;
        this.acceptSnapshot(result.snapshot);
      }
      if (!valid()) return;
      this.releaseBufferedEvents();
      this.persistSoon();
      await this.host.background(() => this.loadCatalog(sessionId));
    });
    if (valid()) { this.releaseBufferedEvents(); this.patch({ loading: false }); }
  }
  /** Leave the conversation while keeping the desktop relay for the session list. */
  async leave() {
    await this.flushCache();
    ++this.selection; this.clearFrameEvents(); await this.history?.close(); await this.boundRelay?.detach(); this.history = undefined;
    this.patch({ selectedId: undefined, snapshot: undefined, messages: [], syncError: undefined });
  }
  /** Stop all conversation work before the desktop context goes away. */
  async close() {
    ++this.selection; await this.flushCache(); this.clearFrameEvents();
    const relay = this.boundRelay; const history = this.history;
    this.boundRelay = undefined; this.history = undefined; this.connectingEvents = undefined;
    await history?.close();
    await relay?.detach();
  }
  private async loadCatalog(sessionId = this.view().selectedId) {
    const relay = this.boundRelay;
    if (!relay || relay.client.state !== "connected" || !sessionId || sessionId !== this.view().selectedId) return;
    const catalog = await relay.modelCatalog(sessionId);
    if (relay === this.boundRelay && sessionId === this.view().selectedId) this.patch({ catalog });
  }
  async configure(input: MobileSessionConfigureInput): Promise<boolean> {
    const relay = this.boundRelay; const sessionId = this.view().selectedId;
    if (!relay || relay.client.state !== "connected" || !sessionId || this.view().configuring) return false;
    let saved = false;
    this.patch({ configuring: true, error: undefined, notice: undefined });
    await this.host.action(async () => {
      const session = await relay.configure(sessionId, input);
      if (relay !== this.boundRelay || sessionId !== this.view().selectedId) return;
      const view = this.view();
      this.patch({
        snapshot: view.snapshot ? { ...view.snapshot, session } : view.snapshot,
        sessions: view.sessions.map((entry) => entry.id === session.id ? session : entry),
        notice: session.configuration?.pendingTurn ? "configurationSaved" : "configurationApplied",
      });
      saved = true;
      await this.loadCatalog(sessionId);
    });
    this.patch({ configuring: false });
    return saved;
  }
  private acceptSnapshot(snapshot: MobileSessionSnapshot) {
    // The transcript lives in `messages`; retaining the page inside the view's
    // snapshot would only duplicate it on every patch.
    this.reconcile({ ...snapshot, items: [] }, snapshotMessages(snapshot));
  }
  /** Apply a light state refresh: live state changes, the transcript stays. */
  private acceptState(state: MobileSessionState, options?: { hasMoreHistory?: boolean; restoreActive?: boolean }) {
    const view = this.view();
    const known = new Set(view.messages.map((message) => message.id));
    const fresh = state.activeItems
      .filter((item) => options?.restoreActive || !known.has(item.id))
      .flatMap((item) => { const message = itemMessage(item); return message ? [message] : []; });
    for (const message of fresh) { this.changed.add(message.id); this.removed.delete(message.id); }
    const messages = fresh.length ? mergeMessages(view.messages, fresh) : view.messages;
    const snapshot: MobileSessionSnapshot = {
      ...state,
      items: [],
      hasMoreHistory: options?.hasMoreHistory ?? view.snapshot?.hasMoreHistory ?? true,
    };
    this.reconcile(snapshot, messages);
  }
  private reconcile(snapshot: MobileSessionSnapshot, messages: UiMessage[]) {
    const pendingId = this.view().uncertainMessageId;
    const confirmed = pendingId && (messages.some((message) => message.id === pendingId) || snapshot.activeTurn?.idempotencyKey === pendingId || snapshot.queuedTurns.some((turn) => turn.idempotencyKey === pendingId));
    if (confirmed) {
      const key = this.draftKey(snapshot.session.id);
      if (!this.uncertain.get(key)?.keepDraft) { this.drafts.delete(key); this.files.delete(key); }
      this.uncertain.delete(key);
    }
    this.patch({ snapshot, messages, ...(confirmed ? { uncertainMessageId: undefined, notice: "deliveryConfirmed" } : {}) });
  }
  handleEvent(event: RacpEventEnvelope) {
    if (event.sessionId !== this.view().selectedId) return;
    if (this.connectingEvents) { this.connectingEvents.push(event); return; }
    // Streaming deltas arrive faster than the screen can usefully paint;
    // coalesce a frame's worth of events into one reduce + one patch.
    this.frameEvents.push(event);
    this.scheduler.schedule(() => this.flushFrameEvents());
  }
  private flushFrameEvents() {
    const events = this.frameEvents;
    this.frameEvents = [];
    if (events.length === 0) return;
    const previous = this.view().messages;
    let messages = previous;
    let stateWorthy = false;
    let catalogWorthy = false;
    for (const event of events) {
      // The selection may have moved between enqueue and this frame.
      if (event.sessionId !== this.view().selectedId) continue;
      messages = applyTranscriptEvent(messages, event);
      if (event.sequence !== undefined && this.history?.entry) this.history.entry.cursor = { epoch: event.epoch, sequence: event.sequence };
      if (!["item.delta", "tool.progress", "item.started"].includes(event.kind)) stateWorthy = true;
      const payload = event.payload as { configurationChanged?: boolean } | undefined;
      if (payload?.configurationChanged) catalogWorthy = true;
    }
    this.track(previous, messages);
    this.patch({ messages }); this.persistSoon();
    // Configuration pushes are the one signal that invalidates the catalog.
    if (catalogWorthy) void this.host.background(() => this.loadCatalog());
    if (stateWorthy) void this.host.background(() => this.refreshState());
  }
  /**
   * Record which rows a live-event reduction changed or superseded. Unchanged
   * rows keep their object identity, so identity is the change signal; rows a
   * reduction drops were replaced (provisional/optimistic) and must not
   * resurface from the cache on the next open.
   */
  private track(previous: readonly UiMessage[], next: readonly UiMessage[]) {
    if (previous === next) return;
    const before = new Map(previous.map((message) => [message.id, message]));
    for (const message of next) {
      if (before.get(message.id) !== message) { this.changed.add(message.id); this.removed.delete(message.id); }
      before.delete(message.id);
    }
    for (const id of before.keys()) { this.removed.add(id); this.changed.delete(id); }
  }
  private clearFrameEvents() {
    this.frameEvents = [];
    this.scheduler.cancel();
  }
  private releaseBufferedEvents() {
    const buffered = this.connectingEvents ?? []; this.connectingEvents = undefined;
    for (const event of buffered) this.handleEvent(event);
  }
  private async reconcileHistory(history: MobileHistory, relay: MobileRelay, valid: () => boolean) {
    try {
      await history.changes(relay, this.view().messages, valid, (messages) => {
        if (!valid()) return;
        const snapshot = this.view().snapshot;
        if (snapshot) this.reconcile(snapshot, messages);
        else this.patch({ messages });
      });
      if (valid()) this.patch({ syncError: undefined });
    } catch (error) {
      if (valid()) this.patch({ syncError: error instanceof Error ? error.message : String(error) });
    }
  }
  /** Coalesced live state and durable changes, preserving events during I/O. */
  async refreshState() {
    const relay = this.boundRelay; const sessionId = this.view().selectedId;
    if (!relay || relay.client.state !== "connected" || !sessionId) return;
    if (this.connectingEvents) return;
    if (this.stateJob) { this.stateAgain = true; return this.stateJob; }
    this.stateJob = (async () => {
      do {
        this.stateAgain = false;
        const state = await relay.state(sessionId);
        if (relay !== this.boundRelay || sessionId !== this.view().selectedId) return;
        const history = this.history;
        if (history && !this.syncingHistory) {
          this.syncingHistory = true;
          try {
            await history.run(async () => {
              if (history !== this.history) return;
              this.acceptState(state);
              // Buffer stream events before the IndexedDB flush; no applied
              // delta may be overwritten by the later changes response.
              this.connectingEvents = [];
              await this.flushCacheNow();
              await this.reconcileHistory(history, relay, () => history === this.history);
            });
          } finally {
            this.syncingHistory = false;
            if (history === this.history) this.releaseBufferedEvents();
          }
        }
        this.persistSoon();
      } while (this.stateAgain);
    })().finally(() => { this.stateJob = undefined; });
    return this.stateJob;
  }
  async earlier() {
    const history = this.history;
    if (!history) return;
    await this.host.action(async () => {
      await history.run(async () => {
        const first = this.view().messages[0];
        if (history !== this.history || !first) return;
        const result = await history.earlier(first, this.boundRelay?.client.state === "connected" ? this.boundRelay : undefined);
        if (history !== this.history) return;
        const view = this.view();
        this.patch({ messages: mergeMessages(result.messages, view.messages),
          snapshot: view.snapshot ? { ...view.snapshot, hasMoreHistory: result.hasMore } : undefined });
      });
      if (this.boundRelay?.client.state === "connected") await this.refreshState();
    });
  }
  async itemContent(messageId: string): Promise<UiMessage | undefined> {
    const history = this.history; const relay = this.boundRelay;
    if (!history) return undefined;
    return history.run(async () => {
      if (history !== this.history) return undefined;
      const cached = await this.cache.message(history.address, messageId);
      if (!relay || relay.client.state !== "connected") return cached;
      const message = await relay.item(history.address.sessionId, messageId);
      await history.save([message]);
      if (history === this.history) this.patch({ messages: this.view().messages.map((candidate) => candidate.id === messageId ? message : candidate) });
      return message;
    });
  }
  private persistSoon() {
    if (this.cacheTimer) return;
    this.cacheTimer = setTimeout(() => {
      this.cacheTimer = undefined;
      const history = this.history;
      if (history) void this.host.background(() => history.run(async () => {
        if (history === this.history) await this.persistNow();
      }));
    }, this.persistDelayMs);
  }
  /** Commit the position with only the rows that changed since the last write. */
  private async persistNow() {
    const view = this.view(); const history = this.history;
    if (!view.snapshot || !history || view.snapshot.session.id !== history.address.sessionId) return;
    const changed = this.changed; const removed = this.removed;
    this.changed = new Set(); this.removed = new Set();
    const rows = changed.size ? view.messages.filter((message) => changed.has(message.id)) : [];
    try {
      await history.save(rows, view.snapshot, history.entry?.cursor, [...removed]);
    } catch (error) {
      for (const id of changed) this.changed.add(id);
      for (const id of removed) if (!this.changed.has(id)) this.removed.add(id);
      throw error;
    }
  }
  private async flushCache() {
    const history = this.history;
    if (history) await history.run(async () => {
      if (history === this.history) await this.flushCacheNow();
    });
  }
  private async flushCacheNow() {
    if (this.frameEvents.length) { this.scheduler.cancel(); this.flushFrameEvents(); }
    if (this.cacheTimer) { clearTimeout(this.cacheTimer); this.cacheTimer = undefined; }
    await this.persistNow();
  }
  canLoadEarlier() { return this.view().connection === "connected" || this.view().messages[0]?.id !== this.history?.entry?.oldestId; }
  async continueResponse(messageId: string, text: string): Promise<boolean> {
    const view = this.view();
    const message = view.messages.find(item => item.id === messageId);
    const latest = view.messages.filter(item => !item.parentToolCallId && item.role !== "tool").at(-1);
    if (!message || latest?.id !== messageId || !canContinueResponse(message) || view.connection !== "connected" ||
        view.snapshot?.activeTurn || view.snapshot?.pendingApprovals.length || view.snapshot?.pendingInputs.length ||
        view.snapshot?.session.capabilities.canPrompt !== true || view.snapshot.session.taskMode === "image") return false;
    return this.send(text, [], true);
  }
  async send(text: string, files: PickedAttachment[], keepDraft = false): Promise<boolean> {
    const relay = this.boundRelay; const view = this.view(); const snapshot = view.snapshot;
    if (!relay || relay.client.state !== "connected" || !snapshot || view.busy || view.uncertainMessageId) return false;
    const sessionId = snapshot.session.id; const messageId = crypto.randomUUID();
    this.patch({ busy: true, error: undefined, notice: undefined });
    let started = false;
    try {
      if (snapshot.session.taskMode === "image" && snapshot.imageJobs.some((job) => job.status === "running")) throw new Error("imageBusy");
      if (snapshot.session.taskMode === "image" && files.some((file) => !file.mimeType.startsWith("image/"))) throw new Error("image_files_only");
      const attachments = [];
      for (const file of files) attachments.push(await uploadAttachment(relay, sessionId, file));
      if (relay !== this.boundRelay || sessionId !== this.view().selectedId) throw new Error("Conversation changed before sending");
      started = true;
      await relay.request("turn/start", { sessionId, input: { text, messageId, attachments }, admission: "queue", context: { requestId: messageId, idempotencyKey: messageId } });
      if (!keepDraft) { this.drafts.delete(this.draftKey(sessionId)); this.files.delete(this.draftKey(sessionId)); }
      void this.host.background(() => this.refreshState()); return true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (started && (relay.client.state !== "connected" || code === "TIMEOUT" || code === "HOST_DISCONNECTED")) {
        this.uncertain.set(this.draftKey(sessionId), { messageId, keepDraft }); this.patch({ uncertainMessageId: messageId });
      }
      this.host.report(error); return false;
    } finally { this.patch({ busy: false }); }
  }
  async stop() { await this.mutate("turn/interrupt", {}); }
  async approve(approvalId: string, decision: RacpApprovalDecision) { await this.mutate("approval/respond", { approvalId, decision, ...(decision === "approve" ? { permissionMode: "ask" } : {}) }); }
  async answer(inputId: string, answers: (string[] | null)[]) { await this.mutate("input/respond", { inputId, answers }); }
  /** Remove one queued turn before it runs. */
  async cancelQueued(turnId: string) { await this.mutate("turn/cancel", { turnId }); }
  /** "Send now": promote a queued turn into the running one (ADR 0265). */
  async prioritizeQueued(turnId: string) { await this.mutate("turn/prioritize", { turnId }); }
  async retryImage(messageId: string, imageId: string) { await this.mutate("image/retryDownload", { messageId, imageId }); }
  private async mutate(method: string, params: Record<string, unknown>) {
    await this.host.action(async () => { await this.boundRelay?.request(method, { ...params, sessionId: this.view().selectedId, context: { requestId: crypto.randomUUID() } }); await this.refreshState(); });
  }
  async attachment(messageId: string, attachmentId: string) {
    const history = this.history;
    if (!history) throw new Error("offlineHint");
    const cached = await readAttachment(history.address, messageId, attachmentId);
    if (cached) return cached;
    if (!this.boundRelay || this.boundRelay.client.state !== "connected") throw new Error("offlineHint");
    const result = await downloadAttachment(this.boundRelay, history.address.sessionId, messageId, attachmentId);
    if (history !== this.history) throw new Error("Conversation changed");
    await cacheAttachment(history.address, messageId, attachmentId, result, () => history === this.history);
    return result;
  }
  async allowRetry() {
    await this.host.action(async () => {
      const messageId = this.view().uncertainMessageId; const sessionId = this.view().selectedId; const relay = this.boundRelay;
      if (!messageId || !sessionId || !relay) return;
      const result = await relay.request<{ status: "persisted" | "queued" | "running" | "unknown" }>("message/status", { sessionId, messageId });
      if (relay !== this.boundRelay || sessionId !== this.view().selectedId) return;
      const key = this.draftKey(sessionId);
      const keepDraft = this.uncertain.get(key)?.keepDraft;
      this.uncertain.delete(key);
      if (result.status !== "unknown") { if (!keepDraft) { this.drafts.delete(key); this.files.delete(key); } this.patch({ notice: "deliveryConfirmed" }); }
      this.patch({ uncertainMessageId: undefined }); await this.refreshState();
    });
  }
}
