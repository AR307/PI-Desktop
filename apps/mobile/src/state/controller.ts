import type { MobileSessionConfigureInput, RacpApprovalDecision, UiMessage } from "@pi-desktop/shared";
import type { MobileAccount } from "../services/account";
import { AccountError } from "../services/account";
import type { PickedAttachment } from "../services/attachments";
import { readAccount, saveAccount } from "../services/account-cache";
import { indexedAttentionStore } from "../services/attention-store";
import { clearAccountCache } from "../services/mobile-db";
import { createNotificationBridge, type NotificationBridge, type SettingsTarget } from "../services/notifications";
import type { AttentionItem, AttentionRoute, AttentionStore, NotificationPreferences } from "./attention";
import { MobileConversation, type ConversationOptions } from "./conversation";
import { MobileDirectories } from "./directories";
import { isConnectivityError } from "./errors";
import type { KeepAliveMode } from "./keep-alive";
import { NotificationRuntime } from "./notification-runtime";
import { initialView, type MobileView } from "./view";

export type { MobileView } from "./view";

export type MobileControllerOptions = ConversationOptions & {
  notifications?: NotificationBridge;
  attentionStore?: AttentionStore;
  formatAttention?: (item: AttentionItem) => { title: string; body: string };
  keepAliveText?: (activeTasks: number) => { title: string; body: string };
};

/** Account and grant refreshes while the app is visible; hidden pages back off. */
const ACCOUNT_REFRESH_MS = 15_000;
const HIDDEN_ACCOUNT_REFRESH_MS = 60_000;

/**
 * The app store: account lifecycle, shared computers, navigation and device
 * notifications. The open conversation's workflow lives in
 * `MobileConversation`; the methods below delegate to it so screens and
 * acceptance harnesses keep one entry point.
 */
export class MobileController {
  private value = initialView();
  private readonly listeners = new Set<() => void>();
  private readonly directories: MobileDirectories;
  readonly conversation: MobileConversation;
  readonly notifications: NotificationRuntime;
  private readonly stopTaps: () => void;
  private accountJob?: Promise<void>;
  private accountAgain = false;
  private listTimer?: ReturnType<typeof setTimeout>;
  /** A notification tapped before its computer was restored opens once it is. */
  private pendingRoute?: AttentionRoute;
  constructor(readonly account: MobileAccount, options: MobileControllerOptions = {}) {
    this.conversation = new MobileConversation({
      view: () => this.value,
      patch: (patch) => this.patch(patch),
      action: (operation) => this.action(operation),
      background: (operation) => this.background(operation),
      report: (error) => this.report(error),
      accountId: () => this.account.session?.account.id,
      relay: (desktopId) => this.directories.relay(desktopId),
    }, options);
    const bridge = options.notifications ?? createNotificationBridge();
    this.notifications = new NotificationRuntime({
      bridge,
      store: options.attentionStore ?? indexedAttentionStore,
      format: options.formatAttention ?? ((item) => ({ title: item.sessionTitle, body: item.title ?? item.preview ?? "" })),
      keepAliveText: options.keepAliveText ?? ((count) => ({ title: "PI Mobile", body: String(count) })),
      snapshot: () => ({ signedIn: this.value.signedIn, directories: this.value.directories, ...(this.liveWork() ? { live: this.liveWork() } : {}) }),
      open: () => this.value.selectedId && this.value.desktopId ? { desktopId: this.value.desktopId, sessionId: this.value.selectedId } : undefined,
      changed: (notifications) => this.patch({ notifications }),
      report: (error) => this.report(error, true),
    });
    this.value = { ...this.value, notifications: this.notifications.view };
    this.stopTaps = bridge.onTap((route) => { void this.openFromNotification(route); });
    this.directories = new MobileDirectories(account, {
      changed: (directories) => {
        const row = directories.find((row) => row.desktopDeviceId === this.value.desktopId);
        this.patch({ directories, ...(row ? { sessions: row.sessions, projects: row.projects, connection: row.connection } : {}) });
        this.notifications.update();
        const route = this.pendingRoute;
        if (route && this.directories.row(route.desktopId)) { this.pendingRoute = undefined; void this.background(() => this.openSession(route.desktopId, route.sessionId)); }
      },
      event: (id, event) => { if (id === this.value.desktopId) this.conversation.handleEvent(event); },
      restored: async (id) => { if (id === this.value.desktopId && this.value.selectedId) await this.conversation.select(this.value.selectedId); },
      accountChanged: () => { void this.background(() => this.refreshGrants()); },
      removing: async (id, sessionIds) => {
        this.notifications.attention.forget((item) => item.desktopDeviceId === id && (!sessionIds || sessionIds.includes(item.sessionId)));
        if (id === this.value.desktopId && (!sessionIds || sessionIds.includes(this.value.selectedId ?? ""))) await this.disconnect();
      },
      attention: (id, session, attention) => { void this.notifications.attention.receive(id, session, attention, this.directories.row(id)?.device.name); },
      error: (error) => this.report(error, true),
    });
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<MobileView>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
    // A send or a live-state refresh can start work before the directory row reports it.
    if ("busy" in patch || "snapshot" in patch) this.notifications?.update();
  }
  /** The open conversation while its own live state shows work. */
  private liveWork() {
    const { selectedId, desktopId, snapshot, busy } = this.value;
    if (!selectedId || !desktopId || snapshot?.session.id !== selectedId) return undefined;
    const working = busy || Boolean(snapshot.activeTurn) || snapshot.queuedTurns.length > 0 || snapshot.pendingApprovals.length > 0
      || snapshot.pendingInputs.length > 0 || snapshot.imageJobs.some((job) => job.status === "running");
    return working ? { desktopId, sessionId: selectedId } : undefined;
  }
  /** The current conversation relay (acceptance harnesses issue raw requests through it). */
  get relay() { return this.conversation.relay; }
  get cache() { return this.conversation.cache; }
  get drafts() { return this.conversation.drafts; }
  get files() { return this.conversation.files; }
  get attention() { return this.notifications.attention; }
  draftKey(sessionId?: string) { return this.conversation.draftKey(sessionId); }

  /**
   * Background failures caused only by lost connectivity update the offline
   * state instead of raising an error banner on every refresh attempt.
   */
  private report(error: unknown, background = false) {
    if (isConnectivityError(error)) {
      this.patch({ offline: true, ...(background ? {} : { error: "networkUnavailable", retryAt: undefined }) });
      return;
    }
    if (error instanceof AccountError && error.code === "UNAUTHORIZED") {
      const accountId = this.account.session?.account.id;
      this.stopAccountRefresh();
      void this.account.clear().catch((failure: unknown) => this.patch({ error: String(failure) }));
      this.conversation.clearDrafts();
      void this.disconnect().then(() => this.directories.close()).then(() => accountId ? clearAccountCache(accountId) : undefined)
        .catch((failure: unknown) => this.patch({ error: failure instanceof Error ? failure.message : "cacheFailed" }));
      this.patch({ signedIn: false, grants: [], devices: [], directories: [], projects: [] });
      this.notifications.reset();
    }
    this.patch({ error: error instanceof Error ? error.message : String(error), retryAt: error instanceof AccountError ? error.retryAt : undefined });
  }
  async action(action: () => Promise<void>) {
    this.patch({ error: undefined, notice: undefined, retryAt: undefined });
    try { await action(); } catch (error) { this.report(error); }
  }
  private async background(action: () => Promise<void>) { try { await action(); } catch (error) { this.report(error, true); } }
  clearError() { this.patch({ error: undefined, notice: undefined }); }
  cancelChallenge() { if (!this.value.busy) this.patch({ challenge: undefined, error: undefined }); }
  async start() {
    let restored = false;
    await this.action(async () => { restored = await this.account.restore(); if (restored) await this.loadAccount(); });
    this.patch({ loading: false });
    // Cached computers and history are already visible; reaching MC is background work.
    if (restored && this.value.signedIn) await this.background(() => this.refreshGrants());
  }
  async login(username: string, password: string) {
    if (this.value.busy) return;
    this.patch({ busy: true });
    await this.action(async () => { const result = await this.account.login(username, password); if ("challenge" in result) this.patch({ challenge: result.challenge }); else { await this.loadAccount(); await this.refreshGrants(); } });
    this.patch({ busy: false });
  }
  async challenge(code: string) {
    if (this.value.busy) return;
    const challenge = this.value.challenge; if (!challenge) return;
    this.patch({ busy: true });
    await this.action(async () => { const result = await this.account.challenge(challenge.challengeId, code); if ("challenge" in result) this.patch({ challenge: result.challenge }); else { await this.loadAccount(); await this.refreshGrants(); } });
    this.patch({ busy: false });
  }
  /** Show the cached account immediately; network refresh is started separately. */
  private async loadAccount() {
    this.patch({ signedIn: true, challenge: undefined });
    const accountId = this.account.session!.account.id;
    void this.notifications.attention.load(accountId).catch((error: unknown) => this.report(error, true));
    void this.notifications.refreshState();
    const cached = await readAccount(accountId);
    if (cached) {
      this.patch({ grants: cached.grants, devices: cached.devices.map((device) => ({ ...device, online: false })) });
      await this.directories.restore(cached.grants, cached.devices);
    }
    this.patch({ loading: false });
    this.scheduleAccountRefresh();
  }
  private scheduleAccountRefresh() {
    this.stopAccountRefresh();
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    this.listTimer = setTimeout(() => {
      this.listTimer = undefined;
      if (!this.value.signedIn) return;
      void this.background(() => this.refreshGrants()).finally(() => { if (this.value.signedIn && !this.listTimer) this.scheduleAccountRefresh(); });
    }, hidden ? HIDDEN_ACCOUNT_REFRESH_MS : ACCOUNT_REFRESH_MS);
  }
  private stopAccountRefresh() { clearTimeout(this.listTimer); this.listTimer = undefined; }
  async refreshGrants() {
    if (this.accountJob) { this.accountAgain = true; return this.accountJob; }
    this.accountJob = (async () => {
      do {
        this.accountAgain = false;
        await this.refreshAccountNow();
      } while (this.accountAgain && this.value.signedIn);
    })().finally(() => { this.accountJob = undefined; });
    return this.accountJob;
  }
  private async refreshAccountNow() {
    const identity = this.account.session;
    await this.account.register();
    const [grants, devices] = await Promise.all([this.account.grants(), this.account.devices()]);
    if (!identity || this.account.session?.account.id !== identity.account.id || !this.value.signedIn) return;
    const accountId = this.account.session.account.id;
    this.patch({ grants, devices, ...(this.value.offline ? { offline: false } : {}), ...(this.value.error === "networkUnavailable" ? { error: undefined } : {}) });
    const current = () => this.value.signedIn && this.account.session?.account.id === accountId;
    await saveAccount(accountId, grants, devices, current);
    if (!current()) return;
    await this.directories.sync(grants, devices);
    const row = this.value.desktopId ? this.directories.row(this.value.desktopId) : undefined;
    if (this.value.desktopId && !row) await this.disconnect();
    else if (row) {
      if (!row.grants.some((grant) => grant.id === this.value.grant?.id)) this.patch({ grant: row.grants[0] });
      if (this.value.selectedId && !row.sessions.some((session) => session.id === this.value.selectedId)) await this.closeSession();
    }
  }
  async pair(code: string) { this.patch({ busy: true }); await this.action(async () => { await this.account.pair(code); await this.refreshGrants(); }); this.patch({ busy: false }); }
  async revoke(grantId: string) { await this.action(async () => { await this.account.revoke(grantId); await this.refreshGrants(); }); }

  /** Open a conversation on any shared computer: lists, the inbox and notification taps. */
  async openSession(desktopId: string, sessionId: string) {
    const row = this.directories.row(desktopId);
    if (!row) return;
    if (this.value.desktopId === desktopId && this.value.selectedId === sessionId) { await this.notifications.attention.markSessionRead(desktopId, sessionId); return; }
    const listed = row.sessions.find((session) => session.id === sessionId);
    const grant = row.grants.find((candidate) => candidate.scope.kind === "account")
      ?? row.grants.find((candidate) => candidate.scope.kind === "session" && candidate.scope.id === sessionId)
      ?? row.grants.find((candidate) => candidate.scope.kind === "project" && candidate.scope.id === listed?.projectId)
      ?? row.grants[0];
    if (!grant) return;
    if (this.value.desktopId !== desktopId) {
      await this.disconnect();
      this.conversation.bind(this.directories.relay(desktopId));
      this.patch({ grant, desktopId, sessions: row.sessions, projects: row.projects, connection: row.connection });
    } else this.patch({ grant });
    await this.notifications.attention.markSessionRead(desktopId, sessionId);
    await this.conversation.select(sessionId);
  }
  /** Leave the conversation; relays stay open for lists and activity. */
  async closeSession() {
    await this.conversation.leave();
    this.patch({ desktopId: undefined, grant: undefined, sessions: [], projects: [], catalog: undefined, connection: "disconnected", configuring: false, uncertainMessageId: undefined });
  }
  private async openFromNotification(route: AttentionRoute) {
    if (!this.value.signedIn || !this.directories.row(route.desktopId)) { this.pendingRoute = route; return; }
    await this.background(() => this.openSession(route.desktopId, route.sessionId));
  }
  /** Retry connecting a computer that is reachable again (directory row action). */
  async reconnect(desktopId: string) { await this.action(async () => { await this.directories.connect(desktopId); }); }
  async refreshDirectory(desktopId: string) { await this.background(() => this.directories.refresh(desktopId)); }

  async selectSession(sessionId: string) { await this.conversation.select(sessionId); }
  async configure(input: MobileSessionConfigureInput) { return this.conversation.configure(input); }
  async refreshState() { await this.conversation.refreshState(); }
  async refreshSession() { await this.conversation.refreshState(); }
  async retryHistorySync() { await this.action(() => this.conversation.refreshState()); }
  async earlier() { await this.conversation.earlier(); }
  async itemContent(messageId: string): Promise<UiMessage | undefined> { return this.conversation.itemContent(messageId); }
  canLoadEarlier() { return this.conversation.canLoadEarlier(); }
  async continueResponse(messageId: string, text: string) { return this.conversation.continueResponse(messageId, text); }
  async send(text: string, files: PickedAttachment[], keepDraft = false) { return this.conversation.send(text, files, keepDraft); }
  async stop() { await this.conversation.stop(); }
  async approve(approvalId: string, decision: RacpApprovalDecision) { await this.conversation.approve(approvalId, decision); }
  async answer(inputId: string, answers: (string[] | null)[]) { await this.conversation.answer(inputId, answers); }
  async cancelQueued(turnId: string) { await this.conversation.cancelQueued(turnId); }
  async prioritizeQueued(turnId: string) { await this.conversation.prioritizeQueued(turnId); }
  async attachment(messageId: string, attachmentId: string) { return this.conversation.attachment(messageId, attachmentId); }
  async retryImage(messageId: string, imageId: string) { await this.conversation.retryImage(messageId, imageId); }
  async allowRetry() { await this.conversation.allowRetry(); }

  setNotificationPreferences(preferences: NotificationPreferences) { this.notifications.setPreferences(preferences); }
  setKeepAliveMode(mode: KeepAliveMode) { this.notifications.setKeepAliveMode(mode); }
  async requestNotificationPermission() { await this.action(() => this.notifications.requestPermission()); }
  async openSystemSettings(target: SettingsTarget) { await this.action(() => this.notifications.openSettings(target)); }
  /** The app became visible or moved to the background. */
  setForeground(visible: boolean) { this.notifications.setVisible(visible); }

  back() { void this.background(async () => {
    if (this.value.selectedId) await this.closeSession();
    else await this.disconnect();
  }); }
  async resume() { if (this.value.signedIn) await this.background(async () => { await this.refreshGrants(); await this.conversation.refreshState(); }); }
  async disconnect() {
    await this.conversation.close();
    this.patch({ desktopId: undefined, grant: undefined, selectedId: undefined, snapshot: undefined, messages: [], sessions: [], projects: [], catalog: undefined, syncError: undefined, connection: "disconnected", configuring: false, uncertainMessageId: undefined });
  }
  async logout() {
    const accountId = this.account.session?.account.id;
    this.patch({ signedIn: false });
    this.stopAccountRefresh();
    await this.disconnect(); await this.directories.close();
    const confirmed = await this.account.logout();
    await this.accountJob?.catch(() => undefined);
    this.conversation.clearDrafts();
    this.notifications.reset();
    if (accountId) await clearAccountCache(accountId);
    this.value = { ...initialView(), loading: false, notifications: this.notifications.view, notice: confirmed ? undefined : "logoutPending" }; this.patch({});
  }
  async dispose() {
    this.stopAccountRefresh();
    this.stopTaps();
    this.notifications.dispose();
    await this.disconnect(); await this.directories.close(); this.listeners.clear();
  }
}
