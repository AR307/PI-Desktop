import type { MobileGrant, MobileProject, MobileModelCatalog, MobileSession, MobileSessionConfigureInput, MobileSessionSnapshot, MobileSessionState, RacpApprovalDecision, RacpEventEnvelope, UiMessage } from "@pi-desktop/shared";
import type { RacpClientState } from "@pi-desktop/racp/client";
import { canContinueResponse } from "@pi-desktop/shared";
import type { MobileAccount, MobileAuthChallenge, MobileDevice } from "../services/account";
import { AccountError } from "../services/account";
import { MobileRelay } from "../services/relay";
import { type PickedAttachment, downloadAttachment, uploadAttachment } from "../services/attachments";
import { createTranscriptCache, type TranscriptCache } from "../services/transcript-cache";
import { readAccount, saveAccount } from "../services/account-cache";
import { clearAccountCache } from "../services/mobile-db";
import { cacheAttachment, readAttachment } from "../services/attachment-cache";
import { MobileDirectories, type DesktopDirectory } from "./directories";
import { MobileHistory } from "./history";
import { applyTranscriptEvent, itemMessage, mergeMessages, snapshotMessages } from "./transcript";

export type MobileView = {
  signedIn: boolean; loading: boolean; error?: string; notice?: string; challenge?: MobileAuthChallenge;
  retryAt?: number;
  directories: DesktopDirectory[]; desktopId?: string; projects: MobileProject[];
  grants: MobileGrant[]; devices: MobileDevice[]; grant?: MobileGrant; sessions: MobileSession[];
  selectedId?: string; snapshot?: MobileSessionSnapshot; messages: UiMessage[]; catalog?: MobileModelCatalog;
  connection: RacpClientState; busy: boolean; configuring: boolean; uncertainMessageId?: string;
};

const initialView = (): MobileView => ({ signedIn: false, loading: true, directories: [], projects: [], grants: [], devices: [], sessions: [], messages: [], connection: "disconnected", busy: false, configuring: false });

const CACHE_WRITE_DELAY_MS = 800;

export class MobileController {
  private value = initialView();
  private readonly listeners = new Set<() => void>();
  private relay?: MobileRelay;
  private history?: MobileHistory;
  private readonly directories: MobileDirectories;
  private syncingHistory = false;
  private accountJob?: Promise<void>;
  private selection = 0;
  private connectingEvents?: RacpEventEnvelope[];
  private stateJob?: Promise<void>;
  private stateAgain = false;
  private listTimer?: ReturnType<typeof setInterval>;
  private cacheTimer?: ReturnType<typeof setTimeout>;
  private frameEvents: RacpEventEnvelope[] = [];
  private frameTimer?: number | ReturnType<typeof setTimeout>;
  readonly cache: TranscriptCache = createTranscriptCache();
  readonly drafts = new Map<string, string>();
  readonly files = new Map<string, PickedAttachment[]>();
  draftKey(sessionId = this.value.selectedId ?? "") { return JSON.stringify([this.account.session?.account.id, this.value.desktopId, sessionId]); }
  private readonly uncertain = new Map<string, { messageId: string; keepDraft: boolean }>();
  constructor(readonly account: MobileAccount) {
    this.directories = new MobileDirectories(account, {
      changed: (directories) => {
        const row = directories.find((row) => row.desktopDeviceId === this.value.desktopId);
        this.patch({ directories, ...(row ? { sessions: row.sessions, projects: row.projects, connection: row.connection } : {}) });
      },
      event: (id, event) => { if (id === this.value.desktopId) this.handleEvent(event); },
      restored: async (id) => { if (id === this.value.desktopId && this.value.selectedId) await this.selectSession(this.value.selectedId); },
      accountChanged: () => { void this.background(() => this.refreshGrants()); },
      removing: async (id, sessionIds) => {
        if (id === this.value.desktopId && (!sessionIds || sessionIds.includes(this.value.selectedId ?? ""))) await this.disconnect();
      },
      error: (error) => this.report(error),
    });
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<MobileView>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener(); }
  private report(error: unknown) {
    if (error instanceof AccountError && error.code === "UNAUTHORIZED") {
      const accountId = this.account.session?.account.id;
      clearInterval(this.listTimer); this.listTimer = undefined;
      void this.account.clear().catch((failure: unknown) => this.patch({ error: String(failure) }));
      this.drafts.clear(); this.files.clear(); this.uncertain.clear();
      void this.disconnect().then(() => this.directories.close()).then(() => accountId ? clearAccountCache(accountId) : undefined)
        .catch((failure: unknown) => this.patch({ error: failure instanceof Error ? failure.message : "cacheFailed" }));
      this.patch({ signedIn: false, grants: [], devices: [], directories: [], projects: [] });
    }
    this.patch({ error: error instanceof Error ? error.message : String(error), retryAt: error instanceof AccountError ? error.retryAt : undefined });
  }
  async action(action: () => Promise<void>) { this.patch({ error: undefined, notice: undefined, retryAt: undefined }); await this.background(action); }
  private async background(action: () => Promise<void>) { try { await action(); } catch (error) { this.report(error); } }
  clearError() { this.patch({ error: undefined, notice: undefined }); }
  cancelChallenge() { if (!this.value.busy) this.patch({ challenge: undefined, error: undefined }); }
  async start() { await this.action(async () => { if (await this.account.restore()) await this.loadAccount(); }); this.patch({ loading: false }); }
  async login(username: string, password: string) {
    if (this.value.busy) return;
    this.patch({ busy: true });
    await this.action(async () => { const result = await this.account.login(username, password); if ("challenge" in result) this.patch({ challenge: result.challenge }); else await this.loadAccount(); });
    this.patch({ busy: false });
  }
  async challenge(code: string) {
    if (this.value.busy) return;
    const challenge = this.value.challenge; if (!challenge) return;
    this.patch({ busy: true });
    await this.action(async () => { const result = await this.account.challenge(challenge.challengeId, code); if ("challenge" in result) this.patch({ challenge: result.challenge }); else await this.loadAccount(); });
    this.patch({ busy: false });
  }
  private async loadAccount() {
    this.patch({ signedIn: true, challenge: undefined });
    const accountId = this.account.session!.account.id;
    const cached = await readAccount(accountId);
    if (cached) {
      this.patch({ grants: cached.grants, devices: cached.devices.map((device) => ({ ...device, online: false })) });
      await this.directories.restore(cached.grants, cached.devices);
    }
    this.patch({ loading: false });
    clearInterval(this.listTimer);
    this.listTimer = setInterval(() => { if (this.value.signedIn) void this.background(() => this.refreshGrants()); }, 15_000);
    await this.refreshGrants();
  }
  async refreshGrants() {
    if (this.accountJob) return this.accountJob;
    this.accountJob = this.refreshAccountNow().finally(() => { this.accountJob = undefined; });
    return this.accountJob;
  }
  private async refreshAccountNow() {
    const identity = this.account.session;
    await this.account.register();
    const [grants, devices] = await Promise.all([this.account.grants(), this.account.devices()]);
    if (!identity || this.account.session?.account.id !== identity.account.id || !this.value.signedIn) return;
    const accountId = this.account.session.account.id;
    this.patch({ grants, devices });
    await saveAccount(accountId, grants, devices);
    await this.directories.sync(grants, devices);
    const row = this.value.desktopId ? this.directories.row(this.value.desktopId) : undefined;
    if (this.value.desktopId && !row) await this.disconnect();
    else if (row && this.value.selectedId && !row.sessions.some((session) => session.id === this.value.selectedId)) this.back();
  }
  async pair(code: string) { this.patch({ busy: true }); await this.action(async () => { await this.account.pair(code); await this.refreshGrants(); }); this.patch({ busy: false }); }
  async revoke(grant: MobileGrant) { await this.action(async () => { await this.account.revoke(grant.id); await this.refreshGrants(); }); }
  async openGrant(grant: MobileGrant, desktopId = grant.desktopDeviceId) {
    if (!desktopId) return;
    await this.disconnect();
    const row = this.directories.row(desktopId);
    this.relay = this.directories.relay(desktopId);
    this.patch({ grant, desktopId, sessions: row?.sessions ?? [], projects: row?.projects ?? [], connection: row?.connection ?? "disconnected" });
    if (grant.scope.kind === "session") await this.selectSession(grant.scope.id);
    else if (!this.relay || this.relay.client.state === "error" || this.relay.client.state === "disconnected") {
      await this.action(async () => { const relay = await this.directories.connect(desktopId); if (this.value.desktopId === desktopId) this.relay = relay; });
    }
  }
  private async loadSessions() {
    const desktopId = this.value.desktopId;
    if (desktopId) await this.directories.refresh(desktopId);
  }

  async selectSession(sessionId: string) {
    await this.flushCache();
    const desktopDeviceId = this.value.desktopId; const accountId = this.account.session?.account.id;
    if (!desktopDeviceId || !accountId) return;
    const relay = this.directories.relay(desktopDeviceId);
    this.relay = relay;
    const selection = ++this.selection;
    const valid = () => selection === this.selection && desktopDeviceId === this.value.desktopId;
    this.clearFrameEvents();
    this.connectingEvents = [];
    const history = new MobileHistory({ accountId, desktopDeviceId, sessionId }, this.cache);
    this.history = history;
    this.patch({ selectedId: sessionId, snapshot: undefined, catalog: undefined, messages: [], loading: true, uncertainMessageId: this.uncertain.get(this.draftKey(sessionId))?.messageId });
    await this.action(async () => {
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
        const messages = await history.changes(relay, cached.messages, valid);
        if (!valid()) return;
        this.patch({ messages });
        this.acceptState(result.state, { hasMoreHistory: cached.hasOlderCached || cached.entry?.hasMoreHistory, restoreActive: true });
      } else {
        await history.initialize(result.snapshot);
        if (!valid()) return;
        this.acceptSnapshot(result.snapshot, false);
      }
      await this.loadCatalog(sessionId);
      if (!valid()) return;
      const buffered = this.connectingEvents ?? []; this.connectingEvents = undefined;
      for (const event of buffered) this.handleEvent(event);
      this.persistCacheSoon();
    });
    if (valid()) { this.connectingEvents = undefined; this.patch({ loading: false }); }
  }
  private async loadCatalog(sessionId = this.value.selectedId) {
    const relay = this.relay;
    if (!relay || relay.client.state !== "connected" || !sessionId || sessionId !== this.value.selectedId) return;
    const catalog = await relay.modelCatalog(sessionId);
    if (relay === this.relay && sessionId === this.value.selectedId) this.patch({ catalog });
  }
  async configure(input: MobileSessionConfigureInput): Promise<boolean> {
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || relay.client.state !== "connected" || !sessionId || this.value.configuring) return false;
    let saved = false;
    this.patch({ configuring: true, error: undefined, notice: undefined });
    await this.action(async () => {
      const session = await relay.configure(sessionId, input);
      if (relay !== this.relay || sessionId !== this.value.selectedId) return;
      this.patch({
        snapshot: this.value.snapshot ? { ...this.value.snapshot, session } : this.value.snapshot,
        sessions: this.value.sessions.map((entry) => entry.id === session.id ? session : entry),
        notice: session.configuration?.pendingTurn ? "configurationSaved" : "configurationApplied",
      });
      saved = true;
      await this.loadCatalog(sessionId);
    });
    this.patch({ configuring: false });
    return saved;
  }
  private acceptSnapshot(snapshot: MobileSessionSnapshot, keepHistory: boolean) {
    const incoming = snapshotMessages(snapshot);
    const activeIds = new Set(snapshot.activeItems.map((item) => item.id));
    const existing = new Map(this.value.messages.map((message) => [message.id, message]));
    const messages = keepHistory ? mergeMessages(this.value.messages, incoming.map((message) => activeIds.has(message.id) && existing.has(message.id) ? existing.get(message.id)! : message)) : incoming;
    // The transcript lives in `messages`; retaining the page inside the view's
    // snapshot would only duplicate it on every patch.
    this.reconcile({ ...snapshot, items: [] }, messages);
  }
  /** Apply a light state refresh: live state changes, the transcript stays. */
  private acceptState(state: MobileSessionState, options?: { hasMoreHistory?: boolean; restoreActive?: boolean }) {
    const known = new Set(this.value.messages.map((message) => message.id));
    const fresh = state.activeItems
      .filter((item) => options?.restoreActive || !known.has(item.id))
      .flatMap((item) => { const message = itemMessage(item); return message ? [message] : []; });
    const messages = fresh.length ? mergeMessages(this.value.messages, fresh) : this.value.messages;
    const snapshot: MobileSessionSnapshot = {
      ...state,
      items: [],
      hasMoreHistory: options?.hasMoreHistory ?? this.value.snapshot?.hasMoreHistory ?? true,
    };
    this.reconcile(snapshot, messages);
  }
  private reconcile(snapshot: MobileSessionSnapshot, messages: UiMessage[]) {
    const pendingId = this.value.uncertainMessageId;
    const confirmed = pendingId && (messages.some((message) => message.id === pendingId) || snapshot.activeTurn?.idempotencyKey === pendingId || snapshot.queuedTurns.some((turn) => turn.idempotencyKey === pendingId));
    if (confirmed) {
      if (!this.uncertain.get(this.draftKey(snapshot.session.id))?.keepDraft) { this.drafts.delete(this.draftKey(snapshot.session.id)); this.files.delete(this.draftKey(snapshot.session.id)); }
      this.uncertain.delete(this.draftKey(snapshot.session.id));
    }
    this.patch({ snapshot, messages, ...(confirmed ? { uncertainMessageId: undefined, notice: "deliveryConfirmed" } : {}) });
  }
  private handleEvent(event: RacpEventEnvelope) {
    if (event.sessionId !== this.value.selectedId) return;
    if (this.connectingEvents) { this.connectingEvents.push(event); return; }
    // Streaming deltas arrive faster than the screen can usefully paint;
    // coalesce a frame's worth of events into one reduce + one patch.
    this.frameEvents.push(event);
    if (this.frameTimer !== undefined) return;
    const flush = () => { this.frameTimer = undefined; this.flushFrameEvents(); };
    this.frameTimer = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(flush)
      : setTimeout(flush, 16);
  }
  private flushFrameEvents() {
    const events = this.frameEvents;
    this.frameEvents = [];
    if (events.length === 0) return;
    let messages = this.value.messages;
    let stateWorthy = false;
    let catalogWorthy = false;
    for (const event of events) {
      // The selection may have moved between enqueue and this frame.
      if (event.sessionId !== this.value.selectedId) continue;
      messages = applyTranscriptEvent(messages, event);
      if (event.sequence !== undefined && this.history?.entry) this.history.entry.cursor = { epoch: event.epoch, sequence: event.sequence };
      if (!["item.delta", "tool.progress", "item.started"].includes(event.kind)) stateWorthy = true;
      const payload = event.payload as { configurationChanged?: boolean } | undefined;
      if (payload?.configurationChanged) catalogWorthy = true;
    }
    this.patch({ messages }); this.persistCacheSoon();
    // Configuration pushes are the one signal that invalidates the catalog.
    if (catalogWorthy) void this.background(() => this.loadCatalog());
    if (stateWorthy) void this.background(() => this.refreshState());
  }
  private clearFrameEvents() {
    this.frameEvents = [];
    if (this.frameTimer === undefined) return;
    if (typeof requestAnimationFrame === "function" && typeof this.frameTimer === "number") cancelAnimationFrame(this.frameTimer);
    else clearTimeout(this.frameTimer as ReturnType<typeof setTimeout>);
    this.frameTimer = undefined;
  }
  /** Coalesced live state and durable changes, preserving events during I/O. */
  async refreshState() {
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || relay.client.state !== "connected" || !sessionId) return;
    if (this.connectingEvents) return;
    if (this.stateJob) { this.stateAgain = true; return this.stateJob; }
    this.stateJob = (async () => {
      do {
        this.stateAgain = false;
        const state = await relay.state(sessionId);
        if (relay !== this.relay || sessionId !== this.value.selectedId) return;
        this.acceptState(state);
        const history = this.history;
        if (history && !this.syncingHistory) {
          this.syncingHistory = true;
          try {
            await this.flushCache();
            this.connectingEvents = [];
            const updated = await history.changes(relay, this.value.messages, () => history === this.history);
            if (history === this.history) this.patch({ messages: updated });
          } finally {
            this.syncingHistory = false;
            if (history === this.history) {
              const buffered = this.connectingEvents ?? []; this.connectingEvents = undefined;
              for (const event of buffered) this.handleEvent(event);
            }
          }
        }
        this.persistCacheSoon();
      } while (this.stateAgain);
    })().finally(() => { this.stateJob = undefined; });
    return this.stateJob;
  }
  async refreshSession() { await this.refreshState(); }
  async earlier() {
    const history = this.history; const first = this.value.messages[0];
    if (!history || !first) return;
    await this.action(async () => {
      const result = await history.earlier(first, this.relay?.client.state === "connected" ? this.relay : undefined);
      if (history !== this.history) return;
      this.patch({ messages: mergeMessages(result.messages, this.value.messages),
        snapshot: this.value.snapshot ? { ...this.value.snapshot, hasMoreHistory: result.hasMore } : undefined });
    });
  }
  async itemContent(messageId: string): Promise<UiMessage | undefined> {
    const history = this.history; const relay = this.relay;
    if (!history) return undefined;
    const cached = await this.cache.message(history.address, messageId);
    if (!relay || relay.client.state !== "connected") return cached;
    const message = await relay.item(history.address.sessionId, messageId);
    await history.save([message]);
    if (history === this.history) this.patch({ messages: this.value.messages.map((candidate) => candidate.id === messageId ? message : candidate) });
    return message;
  }
  private persistCacheSoon() {
    if (this.cacheTimer) return;
    this.cacheTimer = setTimeout(() => { this.cacheTimer = undefined; void this.background(() => this.persistCacheNow()); }, CACHE_WRITE_DELAY_MS);
  }
  private async persistCacheNow() {
    const snapshot = this.value.snapshot; const history = this.history;
    if (!snapshot || !history || snapshot.session.id !== history.address.sessionId) return;
    await history.save(this.value.messages, snapshot, history.entry?.cursor);
  }
  private async flushCache() {
    this.flushFrameEvents();
    if (this.cacheTimer) { clearTimeout(this.cacheTimer); this.cacheTimer = undefined; }
    await this.persistCacheNow();
  }
  async continueResponse(messageId: string, text: string): Promise<boolean> {
    const view = this.value;
    const message = view.messages.find(item => item.id === messageId);
    const latest = view.messages.filter(item => !item.parentToolCallId && item.role !== "tool").at(-1);
    if (!message || latest?.id !== messageId || !canContinueResponse(message) || view.connection !== "connected" ||
        view.snapshot?.activeTurn || view.snapshot?.pendingApprovals.length || view.snapshot?.pendingInputs.length ||
        view.snapshot?.session.capabilities.canPrompt !== true || view.snapshot.session.taskMode === "image") return false;
    return this.send(text, [], true);
  }
  async send(text: string, files: PickedAttachment[], keepDraft = false): Promise<boolean> {
    const relay = this.relay; const snapshot = this.value.snapshot; if (!relay || relay.client.state !== "connected" || !snapshot || this.value.busy || this.value.uncertainMessageId) return false;
    const sessionId = snapshot.session.id; const messageId = crypto.randomUUID();
    this.patch({ busy: true, error: undefined, notice: undefined });
    let started = false;
    try {
      if (snapshot.session.taskMode === "image" && snapshot.imageJobs.some((job) => job.status === "running")) throw new Error("imageBusy");
      if (snapshot.session.taskMode === "image" && files.some((file) => !file.mimeType.startsWith("image/"))) throw new Error("image_files_only");
      const attachments = [];
      for (const file of files) attachments.push(await uploadAttachment(relay, sessionId, file));
      if (relay !== this.relay || sessionId !== this.value.selectedId) throw new Error("Conversation changed before sending");
      started = true;
      await relay.request("turn/start", { sessionId, input: { text, messageId, attachments }, admission: "queue", context: { requestId: messageId, idempotencyKey: messageId } });
      if (!keepDraft) { this.drafts.delete(this.draftKey(sessionId)); this.files.delete(this.draftKey(sessionId)); }
      void this.background(() => this.refreshState()); return true;
    } catch (error) { const code = error && typeof error === "object" && "code" in error ? error.code : undefined; if (started && (relay.client.state !== "connected" || code === "TIMEOUT" || code === "HOST_DISCONNECTED")) { this.uncertain.set(this.draftKey(sessionId), { messageId, keepDraft }); this.patch({ uncertainMessageId: messageId }); } this.report(error); return false; }
    finally { this.patch({ busy: false }); }
  }
  async stop() { await this.mutate("turn/interrupt", {}); }
  async approve(approvalId: string, decision: RacpApprovalDecision) { await this.mutate("approval/respond", { approvalId, decision, ...(decision === "approve" ? { permissionMode: "ask" } : {}) }); }
  async answer(inputId: string, answers: (string[] | null)[]) { await this.mutate("input/respond", { inputId, answers }); }
  /** Remove one queued turn before it runs. */
  async cancelQueued(turnId: string) { await this.mutate("turn/cancel", { turnId }); }
  /** "Send now": promote a queued turn into the running one (ADR 0265). */
  async prioritizeQueued(turnId: string) { await this.mutate("turn/prioritize", { turnId }); }
  private async mutate(method: string, params: Record<string, unknown>) {
    await this.action(async () => { await this.relay?.request(method, { ...params, sessionId: this.value.selectedId, context: { requestId: crypto.randomUUID() } }); await this.refreshState(); });
  }
  async attachment(messageId: string, attachmentId: string) {
    const history = this.history;
    if (!history) throw new Error("offlineHint");
    const cached = await readAttachment(history.address, messageId, attachmentId);
    if (cached) return cached;
    if (!this.relay || this.relay.client.state !== "connected") throw new Error("offlineHint");
    const result = await downloadAttachment(this.relay, history.address.sessionId, messageId, attachmentId);
    if (history !== this.history) throw new Error("Conversation changed");
    await cacheAttachment(history.address, messageId, attachmentId, result);
    return result;
  }
  async retryImage(messageId: string, imageId: string) { await this.mutate("image/retryDownload", { messageId, imageId }); }
  async allowRetry() { await this.action(async () => {
    const messageId = this.value.uncertainMessageId; const sessionId = this.value.selectedId; const relay = this.relay;
    if (!messageId || !sessionId || !relay) return;
    const result = await relay.request<{ status: "persisted" | "queued" | "running" | "unknown" }>("message/status", { sessionId, messageId });
    if (relay !== this.relay || sessionId !== this.value.selectedId) return;
    const keepDraft = this.uncertain.get(this.draftKey(sessionId))?.keepDraft;
    this.uncertain.delete(this.draftKey(sessionId));
    if (result.status !== "unknown") { if (!keepDraft) { this.drafts.delete(this.draftKey(sessionId)); this.files.delete(this.draftKey(sessionId)); } this.patch({ notice: "deliveryConfirmed" }); }
    this.patch({ uncertainMessageId: undefined }); await this.refreshState();
  }); }
  back() { void this.background(async () => {
    await this.flushCache();
    if (this.value.selectedId && this.value.grant?.scope.kind !== "session") {
      ++this.selection; this.clearFrameEvents(); await this.relay?.detach(); this.history = undefined;
      this.patch({ selectedId: undefined, snapshot: undefined, messages: [] });
    } else await this.disconnect();
  }); }
  async resume() { if (this.value.signedIn) await this.background(async () => { await this.refreshGrants(); await this.refreshState(); }); }
  async disconnect() {
    ++this.selection; await this.flushCache(); this.clearFrameEvents();
    const relay = this.relay; this.relay = undefined; this.history = undefined;
    await relay?.detach();
    this.patch({ desktopId: undefined, grant: undefined, selectedId: undefined, snapshot: undefined, messages: [], sessions: [], projects: [], catalog: undefined, connection: "disconnected", configuring: false, uncertainMessageId: undefined });
  }
  async logout() {
    const accountId = this.account.session?.account.id;
    this.patch({ signedIn: false });
    clearInterval(this.listTimer); this.listTimer = undefined;
    await this.disconnect(); await this.directories.close();
    const confirmed = await this.account.logout();
    await this.accountJob?.catch(() => undefined);
    this.drafts.clear(); this.files.clear(); this.uncertain.clear();
    if (accountId) await clearAccountCache(accountId);
    this.value = { ...initialView(), loading: false, notice: confirmed ? undefined : "logoutPending" }; this.patch({});
  }
  async dispose() {
    clearInterval(this.listTimer); this.listTimer = undefined;
    await this.disconnect(); await this.directories.close(); this.listeners.clear();
  }
}
