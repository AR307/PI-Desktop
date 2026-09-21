import type { MobileGrant, MobileSession, MobileSessionSnapshot, RacpApprovalDecision, RacpEventEnvelope, UiMessage } from "@pi-desktop/shared";
import type { RacpClientState } from "@pi-desktop/racp/client";
import type { MobileAccount, MobileAuthChallenge, MobileDevice } from "../services/account";
import { AccountError } from "../services/account";
import { MobileRelay } from "../services/relay";
import { type PickedAttachment, downloadAttachment, uploadAttachment } from "../services/attachments";
import { applyTranscriptEvent, itemMessage, mergeMessages, snapshotMessages } from "./transcript";

export type MobileView = {
  signedIn: boolean; loading: boolean; error?: string; notice?: string; challenge?: MobileAuthChallenge;
  grants: MobileGrant[]; devices: MobileDevice[]; grant?: MobileGrant; sessions: MobileSession[];
  selectedId?: string; snapshot?: MobileSessionSnapshot; messages: UiMessage[];
  connection: RacpClientState; busy: boolean; uncertainMessageId?: string;
};

const initialView = (): MobileView => ({ signedIn: false, loading: true, grants: [], devices: [], sessions: [], messages: [], connection: "disconnected", busy: false });

export class MobileController {
  private value = initialView();
  private readonly listeners = new Set<() => void>();
  private relay?: MobileRelay;
  private selection = 0;
  private connectingEvents?: RacpEventEnvelope[];
  private refreshJob?: Promise<void>;
  private refreshAgain = false;
  private listTimer?: ReturnType<typeof setInterval>;
  readonly drafts = new Map<string, string>();
  readonly files = new Map<string, PickedAttachment[]>();
  private readonly uncertain = new Map<string, string>();
  constructor(readonly account: MobileAccount) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<MobileView>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener(); }
  private report(error: unknown) {
    if (error instanceof AccountError && error.code === "UNAUTHORIZED") { this.drafts.clear(); this.files.clear(); this.uncertain.clear(); this.patch({ signedIn: false, grants: [], devices: [] }); void this.disconnect(); }
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
  async refreshGrants() { const [grants, devices] = await Promise.all([this.account.grants(), this.account.devices()]); if (!this.account.session) return; if (this.value.grant && !grants.some((grant) => grant.id === this.value.grant?.id)) await this.disconnect(); this.patch({ grants, devices }); }
  async pair(code: string) { this.patch({ busy: true }); await this.action(async () => { await this.account.pair(code); await this.refreshGrants(); }); this.patch({ busy: false }); }
  async revoke(grant: MobileGrant) { await this.action(async () => { await this.account.revoke(grant.id); if (this.value.grant?.id === grant.id) await this.disconnect(); await this.refreshGrants(); }); }
  async openGrant(grant: MobileGrant) {
    await this.disconnect();
    const selection = ++this.selection;
    this.patch({ grant, sessions: [], selectedId: undefined, snapshot: undefined, messages: [] });
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
    const relay = this.relay; if (!relay) return;
    const selection = ++this.selection;
    this.connectingEvents = [];
    this.patch({ selectedId: sessionId, snapshot: undefined, messages: [], loading: true, uncertainMessageId: this.uncertain.get(sessionId) });
    await this.action(async () => {
      const snapshot = await relay.attach(sessionId);
      if (selection !== this.selection || relay !== this.relay) return;
      this.acceptSnapshot(snapshot, false);
      const buffered = this.connectingEvents ?? []; this.connectingEvents = undefined;
      for (const event of buffered) this.handleEvent(event);
    });
    if (selection === this.selection) { this.connectingEvents = undefined; this.patch({ loading: false }); }
  }
  private acceptSnapshot(snapshot: MobileSessionSnapshot, keepHistory: boolean) {
    const incoming = snapshotMessages(snapshot);
    const activeIds = new Set(snapshot.activeItems.map((item) => item.id));
    const existing = new Map(this.value.messages.map((message) => [message.id, message]));
    const messages = keepHistory ? mergeMessages(this.value.messages, incoming.map((message) => activeIds.has(message.id) && existing.has(message.id) ? existing.get(message.id)! : message)) : incoming;
    const pendingId = this.value.uncertainMessageId;
    const confirmed = pendingId && (messages.some((message) => message.id === pendingId) || snapshot.activeTurn?.idempotencyKey === pendingId || snapshot.queuedTurns.some((turn) => turn.idempotencyKey === pendingId));
    if (confirmed) { this.uncertain.delete(snapshot.session.id); this.drafts.delete(snapshot.session.id); this.files.delete(snapshot.session.id); }
    this.patch({ snapshot, messages, ...(confirmed ? { uncertainMessageId: undefined, notice: "deliveryConfirmed" } : {}) });
  }
  private handleEvent(event: RacpEventEnvelope) {
    if (event.sessionId !== this.value.selectedId) return;
    if (this.connectingEvents) { this.connectingEvents.push(event); return; }
    this.patch({ messages: applyTranscriptEvent(this.value.messages, event) });
    if (!["item.delta", "tool.progress", "item.started"].includes(event.kind)) void this.background(() => this.refreshSession());
  }
  async refreshSession() {
    if (this.refreshJob) { this.refreshAgain = true; return this.refreshJob; }
    const relay = this.relay; const sessionId = this.value.selectedId;
    if (!relay || !sessionId) return;
    this.refreshJob = (async () => { do { this.refreshAgain = false; const snapshot = await relay.snapshot(sessionId); if (relay !== this.relay || sessionId !== this.value.selectedId) return; this.acceptSnapshot(snapshot, true); } while (this.refreshAgain); })().finally(() => { this.refreshJob = undefined; });
    return this.refreshJob;
  }
  async earlier() {
    const relay = this.relay; const sessionId = this.value.selectedId; const first = this.value.messages[0]; if (!relay || !sessionId || !first) return;
    await this.action(async () => { const page = await relay.history(sessionId, first.id); if (relay !== this.relay || sessionId !== this.value.selectedId) return; this.patch({ messages: mergeMessages(page.items.flatMap((item) => { const message = itemMessage(item); return message ? [message] : []; }), this.value.messages), snapshot: this.value.snapshot ? { ...this.value.snapshot, hasMoreHistory: page.hasMore } : undefined }); });
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
      this.drafts.delete(sessionId); this.files.delete(sessionId); void this.background(() => this.refreshSession()); return true;
    } catch (error) { const code = error && typeof error === "object" && "code" in error ? error.code : undefined; if (started && (relay.client.state !== "connected" || code === "TIMEOUT" || code === "HOST_DISCONNECTED")) { this.uncertain.set(sessionId, messageId); this.patch({ uncertainMessageId: messageId }); } this.report(error); return false; }
    finally { this.patch({ busy: false }); }
  }
  async stop() { await this.mutate("turn/interrupt", {}); }
  async approve(approvalId: string, decision: RacpApprovalDecision) { await this.mutate("approval/respond", { approvalId, decision, ...(decision === "approve" ? { permissionMode: "ask" } : {}) }); }
  async answer(inputId: string, answers: (string[] | null)[]) { await this.mutate("input/respond", { inputId, answers }); }
  private async mutate(method: string, params: Record<string, unknown>) {
    await this.action(async () => { await this.relay?.request(method, { ...params, sessionId: this.value.selectedId, context: { requestId: crypto.randomUUID() } }); await this.refreshSession(); });
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
    this.patch({ uncertainMessageId: undefined }); await this.refreshSession();
  }); }
  back() { if (this.value.selectedId && this.value.grant?.scope.kind !== "session") { ++this.selection; this.patch({ selectedId: undefined, snapshot: undefined, messages: [] }); } else void this.disconnect(); }
  async resume() { if (!this.value.signedIn) return; await this.background(async () => { await this.refreshGrants(); if (this.relay?.client.state === "connected") { await this.loadSessions(); await this.refreshSession(); } }); }
  async disconnect() { ++this.selection; clearInterval(this.listTimer); this.listTimer = undefined; const relay = this.relay; this.relay = undefined; await relay?.close(); this.patch({ grant: undefined, selectedId: undefined, snapshot: undefined, messages: [], sessions: [], connection: "disconnected", uncertainMessageId: undefined }); }
  async logout() { await this.disconnect(); const confirmed = await this.account.logout(); this.drafts.clear(); this.files.clear(); this.uncertain.clear(); this.value = { ...initialView(), loading: false, notice: confirmed ? undefined : "logoutPending" }; this.patch({}); }
  async dispose() { await this.disconnect(); this.listeners.clear(); }
}
