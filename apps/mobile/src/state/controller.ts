import type { MobileGrant, MobileModelCatalog, MobileSession, MobileSessionConfigureInput, MobileSessionSnapshot, MobileSessionState, RacpApprovalDecision, RacpEventEnvelope, UiMessage } from "@pi-desktop/shared";
import type { RacpClientState } from "@pi-desktop/racp/client";
import type { MobileAccount, MobileAuthChallenge, MobileDevice } from "../services/account";
import { AccountError } from "../services/account";
import { MobileRelay } from "../services/relay";
import { type PickedAttachment, downloadAttachment, uploadAttachment } from "../services/attachments";
import { boundedCacheMessages, cacheKey, createTranscriptCache, type TranscriptCache } from "../services/transcript-cache";
import { applyTranscriptEvent, itemMessage, mergeMessages, snapshotMessages } from "./transcript";

export type MobileView = {
  signedIn: boolean; loading: boolean; error?: string; notice?: string; challenge?: MobileAuthChallenge;
  grants: MobileGrant[]; devices: MobileDevice[]; grant?: MobileGrant; sessions: MobileSession[];
  selectedId?: string; snapshot?: MobileSessionSnapshot; messages: UiMessage[]; catalog?: MobileModelCatalog;
  connection: RacpClientState; busy: boolean; configuring: boolean; uncertainMessageId?: string;
};

const initialView = (): MobileView => ({ signedIn: false, loading: true, grants: [], devices: [], sessions: [], messages: [], connection: "disconnected", busy: false, configuring: false });

const CACHE_WRITE_DELAY_MS = 800;

export class MobileController {
  private value = initialView();
  private readonly listeners = new Set<() => void>();
  private relay?: MobileRelay;
  private selection = 0;
  private connectingEvents?: RacpEventEnvelope[];
  private refreshJob?: Promise<void>;
  private refreshAgain = false;
  private stateJob?: Promise<void>;
  private stateAgain = false;
  private listTimer?: ReturnType<typeof setInterval>;
  private cacheTimer?: ReturnType<typeof setTimeout>;
  private frameEvents: RacpEventEnvelope[] = [];
  private frameTimer?: number | ReturnType<typeof setTimeout>;
  readonly cache: TranscriptCache = createTranscriptCache();
  readonly drafts = new Map<string, string>();
  readonly files = new Map<string, PickedAttachment[]>();
  private readonly uncertain = new Map<string, string>();
  constructor(readonly account: MobileAccount) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<MobileView>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener(); }
  private report(error: unknown) {
    if (error instanceof AccountError && error.code === "UNAUTHORIZED") { this.drafts.clear(); this.files.clear(); this.uncertain.clear(); void this.cache.clearAll().catch(() => undefined); this.patch({ signedIn: false, grants: [], devices: [] }); void this.disconnect(); }
    this.patch({ error: error instanceof Error ? error.message : String(error) });
  }
  async action(action: () => Promise<void>) { this.patch({ error: undefined, notice: undefined }); await this.background(action); }
  private async background(action: () => Promise<void>) { try { await action(); } catch (error) { this.report(error); } }
  clearError() { this.patch({ error: undefined, notice: undefined }); }
  cancelChallenge() { if (!this.value.busy) this.patch({ challenge: undefined, error: undefined }); }
  async start() { await this.action(async () => { if (await this.account.restore()) await this.loadAccount(); }); this.patch({ loading: false }); }
  async login(username: string, password: string) {
    this.patch({ busy: true });
    await this.action(async () => { const result = await this.account.login(username, password); if ("challenge" in result) this.patch({ challenge: result.challenge }); else await this.loadAccount(); });
    this.patch({ busy: false });
  }
  async challenge(code: string) {
    const challenge = this.value.challenge; if (!challenge) return;
    this.patch({ busy: true });
    await this.action(async () => { const result = await this.account.challenge(challenge.challengeId, code); if ("challenge" in result) this.patch({ challenge: result.challenge }); else await this.loadAccount(); });
    this.patch({ busy: false });
  }
  private async loadAccount() { await this.account.register(); this.patch({ signedIn: true, challenge: undefined }); await this.refreshGrants(); }
  async refreshGrants() {
    const [grants, devices] = await Promise.all([this.account.grants(), this.account.devices()]);
    if (!this.account.session) return;
    // A share revoked elsewhere must not leave its transcript on this device.
    for (const previous of this.value.grants) {
      if (!grants.some((grant) => grant.id === previous.id)) void this.cache.clearGrant(previous.id).catch(() => undefined);
    }
    if (this.value.grant && !grants.some((grant) => grant.id === this.value.grant?.id)) await this.disconnect();
    this.patch({ grants, devices });
  }
  async pair(code: string) { this.patch({ busy: true }); await this.action(async () => { await this.account.pair(code); await this.refreshGrants(); }); this.patch({ busy: false }); }
  async revoke(grant: MobileGrant) { await this.action(async () => { await this.account.revoke(grant.id); void this.cache.clearGrant(grant.id).catch(() => undefined); if (this.value.grant?.id === grant.id) await this.disconnect(); await this.refreshGrants(); }); }
  async openGrant(grant: MobileGrant) {
    await this.disconnect();
    const selection = ++this.selection;
    this.patch({ grant, sessions: [], selectedId: undefined, snapshot: undefined, messages: [], catalog: undefined });
    const relay = new MobileRelay(this.account, grant.desktopDeviceId, {
      event: (event) => { if (this.relay === relay) this.handleEvent(event); },
      state: (connection) => { if (this.relay === relay) { this.patch({ connection }); if (connection === "reconnecting") void this.background(() => this.refreshGrants()); } },
      restored: async () => { if (this.relay !== relay) return; await this.loadSessions(); if (this.value.selectedId) await this.selectSession(this.value.selectedId); },
      error: (error) => { if (relay === this.relay && relay.client.state === "connected") this.report(error); },
    });
    this.relay = relay;
    await this.action(async () => { await relay.connect(); if (selection !== this.selection) return; await this.loadSessions(); if (grant.scope.kind === "session") await this.selectSession(grant.scope.id); });
    if (this.relay === relay) this.listTimer = setInterval(() => { if (this.relay?.client.state === "connected") void this.background(async () => { await this.refreshGrants(); await this.loadSessions(); }); }, 10_000);
  }
  private async loadSessions() {
    const relay = this.relay; const grant = this.value.grant; if (!relay || !grant) return;
    const sessions = await relay.sessions(grant.id); if (relay !== this.relay) return;
    const selected = sessions.find((session) => session.id === this.value.selectedId);
    this.patch({ sessions, ...(selected && this.value.snapshot ? { snapshot: { ...this.value.snapshot, session: selected } } : {}) });
  }
  async selectSession(sessionId: string) {
    const relay = this.relay; const grant = this.value.grant; if (!relay || !grant) return;
    const selection = ++this.selection;
    this.clearFrameEvents();
    this.connectingEvents = [];
    // Reattaching the already-open session (reconnect) resumes from the live
    // in-memory transcript and the client's last durable cursor; a fresh open
    // renders the persisted cache first, then replays only the gap. The route
    // flip patches synchronously so a view transition can capture it.
    const live = this.value.selectedId === sessionId && this.value.messages.length > 0;
    this.patch({ selectedId: sessionId, ...(live ? {} : { snapshot: undefined, catalog: undefined, messages: [] }), loading: true, uncertainMessageId: this.uncertain.get(sessionId) });
    const cached = live ? undefined : await this.cache.get(grant.desktopDeviceId, sessionId).catch(() => undefined);
    if (selection !== this.selection || relay !== this.relay) return;
    const resume = live
      ? { messages: this.value.messages, cursor: relay.client.cursorFor(sessionId) ?? this.value.snapshot?.cursor, hasMoreHistory: this.value.snapshot?.hasMoreHistory ?? true }
      : cached && cached.messages.length > 0
        ? { messages: cached.messages, cursor: cached.cursor, hasMoreHistory: cached.hasMoreHistory }
        : undefined;
    if (!live && resume) this.patch({ messages: resume.messages });
    await this.action(async () => {
      const result = await relay.attach(sessionId, resume?.cursor);
      if (selection !== this.selection || relay !== this.relay) return;
      if (result.kind === "state") this.acceptState(result.state, { hasMoreHistory: resume?.hasMoreHistory });
      else this.acceptSnapshot(result.snapshot, false);
      await this.loadCatalog(sessionId);
      const buffered = this.connectingEvents ?? []; this.connectingEvents = undefined;
      for (const event of buffered) this.handleEvent(event);
      this.persistCacheSoon();
    });
    if (selection === this.selection) { this.connectingEvents = undefined; this.patch({ loading: false }); }
  }
  private async loadCatalog(sessionId = this.value.selectedId) {
    const relay = this.relay;
    if (!relay || !sessionId || sessionId !== this.value.selectedId) return;
    const catalog = await relay.modelCatalog(sessionId);
    if (relay === this.relay && sessionId === this.value.selectedId) this.patch({ catalog });
  }
  async configure(input: MobileSessionConfigureInput): Promise<boolean> {
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || !sessionId || this.value.configuring) return false;
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
  private acceptState(state: MobileSessionState, options?: { hasMoreHistory?: boolean }) {
    const known = new Set(this.value.messages.map((message) => message.id));
    const fresh = state.activeItems
      .filter((item) => !known.has(item.id))
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
    if (confirmed) { this.uncertain.delete(snapshot.session.id); this.drafts.delete(snapshot.session.id); this.files.delete(snapshot.session.id); }
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
      if (!["item.delta", "tool.progress", "item.started"].includes(event.kind)) stateWorthy = true;
      const payload = event.payload as { configurationChanged?: boolean } | undefined;
      if (payload?.configurationChanged) catalogWorthy = true;
    }
    if (messages !== this.value.messages) { this.patch({ messages }); this.persistCacheSoon(); }
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
  /**
   * Light live-state refresh (`session/state`), coalesced. Desktops without
   * the method fall back to the full snapshot refresh.
   */
  async refreshState() {
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || !sessionId) return;
    if (!relay.supportsSessionState) return this.refreshSession();
    if (this.stateJob) { this.stateAgain = true; return this.stateJob; }
    this.stateJob = (async () => {
      do {
        this.stateAgain = false;
        const state = await relay.state(sessionId);
        if (relay !== this.relay || sessionId !== this.value.selectedId) return;
        this.acceptState(state);
        this.persistCacheSoon();
      } while (this.stateAgain);
    })().finally(() => { this.stateJob = undefined; });
    return this.stateJob;
  }
  /** Full snapshot refresh: the legacy-desktop path and the stale-cache resync. */
  async refreshSession() {
    if (this.refreshJob) { this.refreshAgain = true; return this.refreshJob; }
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || !sessionId) return;
    this.refreshJob = (async () => { do { this.refreshAgain = false; const snapshot = await relay.snapshot(sessionId); if (relay !== this.relay || sessionId !== this.value.selectedId) return; this.acceptSnapshot(snapshot, true); this.persistCacheSoon(); } while (this.refreshAgain); })().finally(() => { this.refreshJob = undefined; });
    return this.refreshJob;
  }
  async earlier() {
    const relay = this.relay; const sessionId = this.value.selectedId; const first = this.value.messages[0]; if (!relay || !sessionId || !first) return;
    await this.action(async () => { const page = await relay.history(sessionId, first.id); if (relay !== this.relay || sessionId !== this.value.selectedId) return; this.patch({ messages: mergeMessages(page.items.flatMap((item) => { const message = itemMessage(item); return message ? [message] : []; }), this.value.messages), snapshot: this.value.snapshot ? { ...this.value.snapshot, hasMoreHistory: page.hasMore } : undefined }); this.persistCacheSoon(); });
  }
  /** Fetch one item's complete, uncapped content (`session/item`). */
  async itemContent(messageId: string): Promise<UiMessage | undefined> {
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || !sessionId || !relay.supportsItemContent) return undefined;
    const message = await relay.item(sessionId, messageId);
    if (relay !== this.relay || sessionId !== this.value.selectedId) return message;
    this.patch({ messages: this.value.messages.map((candidate) => candidate.id === messageId ? message : candidate) });
    return message;
  }
  private persistCacheSoon() {
    if (this.cacheTimer) return;
    this.cacheTimer = setTimeout(() => { this.cacheTimer = undefined; this.persistCacheNow(); }, CACHE_WRITE_DELAY_MS);
  }
  private persistCacheNow() {
    const grant = this.value.grant; const sessionId = this.value.selectedId; const snapshot = this.value.snapshot;
    if (!grant || !sessionId || !snapshot || snapshot.session.id !== sessionId) return;
    const cursor = this.relay?.client.cursorFor(sessionId) ?? snapshot.cursor;
    void this.cache.put({
      key: cacheKey(grant.desktopDeviceId, sessionId),
      desktopDeviceId: grant.desktopDeviceId,
      grantId: grant.id,
      sessionId,
      cursor,
      revision: snapshot.revision,
      hasMoreHistory: snapshot.hasMoreHistory,
      messages: boundedCacheMessages(this.value.messages),
      updatedAt: Date.now(),
    }).catch(() => undefined);
  }
  private flushCache() {
    if (this.cacheTimer) { clearTimeout(this.cacheTimer); this.cacheTimer = undefined; this.persistCacheNow(); }
  }
  async send(text: string, files: PickedAttachment[]): Promise<boolean> {
    const relay = this.relay; const snapshot = this.value.snapshot; if (!relay || !snapshot || this.value.busy || this.value.uncertainMessageId) return false;
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
      this.drafts.delete(sessionId); this.files.delete(sessionId); void this.background(() => this.refreshState()); return true;
    } catch (error) { const code = error && typeof error === "object" && "code" in error ? error.code : undefined; if (started && (relay.client.state !== "connected" || code === "TIMEOUT" || code === "HOST_DISCONNECTED")) { this.uncertain.set(sessionId, messageId); this.patch({ uncertainMessageId: messageId }); } this.report(error); return false; }
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
  async attachment(messageId: string, attachmentId: string) { if (!this.relay || !this.value.selectedId) throw new Error("Desktop offline"); return downloadAttachment(this.relay, this.value.selectedId, messageId, attachmentId); }
  async retryImage(messageId: string, imageId: string) { await this.mutate("image/retryDownload", { messageId, imageId }); }
  async allowRetry() { await this.action(async () => {
    const messageId = this.value.uncertainMessageId; const sessionId = this.value.selectedId; const relay = this.relay;
    if (!messageId || !sessionId || !relay) return;
    const result = await relay.request<{ status: "persisted" | "queued" | "running" | "unknown" }>("message/status", { sessionId, messageId });
    if (relay !== this.relay || sessionId !== this.value.selectedId) return;
    this.uncertain.delete(sessionId);
    if (result.status !== "unknown") { this.drafts.delete(sessionId); this.files.delete(sessionId); this.patch({ notice: "deliveryConfirmed" }); }
    this.patch({ uncertainMessageId: undefined }); await this.refreshState();
  }); }
  back() { this.flushCache(); if (this.value.selectedId && this.value.grant?.scope.kind !== "session") { ++this.selection; this.clearFrameEvents(); this.patch({ selectedId: undefined, snapshot: undefined, messages: [] }); } else void this.disconnect(); }
  async resume() { if (!this.value.signedIn) return; await this.background(async () => { await this.refreshGrants(); if (this.relay?.client.state === "connected") { await this.loadSessions(); await this.refreshState(); } }); }
  async disconnect() { ++this.selection; this.flushCache(); this.clearFrameEvents(); clearInterval(this.listTimer); this.listTimer = undefined; const relay = this.relay; this.relay = undefined; await relay?.close(); this.patch({ grant: undefined, selectedId: undefined, snapshot: undefined, messages: [], sessions: [], catalog: undefined, connection: "disconnected", configuring: false, uncertainMessageId: undefined }); }
  async logout() { await this.disconnect(); const confirmed = await this.account.logout(); this.drafts.clear(); this.files.clear(); this.uncertain.clear(); void this.cache.clearAll().catch(() => undefined); this.value = { ...initialView(), loading: false, notice: confirmed ? undefined : "logoutPending" }; this.patch({}); }
  async dispose() { await this.disconnect(); this.listeners.clear(); }
}
