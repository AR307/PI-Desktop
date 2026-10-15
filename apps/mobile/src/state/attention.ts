import type { MobileAttention, MobileAttentionKind, MobileSession } from "@pi-desktop/shared";

/** One received attention, kept in the account-scoped Activity inbox. */
export type AttentionItem = {
  key: string;
  accountId: string;
  desktopDeviceId: string;
  sessionId: string;
  /** Matches the transcript cache key so a session leaving the share clears its items. */
  sessionKey: string;
  attentionId: string;
  kind: Exclude<MobileAttentionKind, "resolved">;
  requestKind?: MobileAttention["requestKind"];
  sessionTitle: string;
  desktopName?: string;
  title?: string;
  preview?: string;
  errorCode?: string;
  image?: boolean;
  occurredAt: string;
  receivedAt: string;
  read: boolean;
  /** A needs-action item whose request was answered from either device. */
  resolved?: boolean;
};

export type AttentionCategory = "needsAction" | "completed" | "failed";
export const attentionCategory = (kind: AttentionItem["kind"]): AttentionCategory =>
  kind === "approval" || kind === "input" ? "needsAction" : kind;

export type NotificationPreferences = { enabled: boolean; needsAction: boolean; completed: boolean; failed: boolean };
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { enabled: true, needsAction: true, completed: true, failed: true };

export type AttentionRoute = { desktopId: string; sessionId: string };
export type AttentionNotification = {
  tag: string;
  channel: "attention" | "results";
  title: string;
  body: string;
  /** The computer name, shown in the notification header. */
  subtitle?: string;
  route: AttentionRoute;
  when: number;
};
/** System notifications (native), recorded ones (acceptance) or none (browser preview). */
export interface AttentionPresenter {
  show(notification: AttentionNotification): Promise<void>;
  clear(tag: string): Promise<void>;
}
export interface AttentionStore {
  load(accountId: string): Promise<AttentionItem[]>;
  save(items: AttentionItem[]): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export type AttentionEnvironment = {
  presenter: AttentionPresenter;
  store: AttentionStore;
  preferences(): NotificationPreferences;
  /** Whether the app is in front of the user, and which conversation is open. */
  foreground(): { visible: boolean; open?: AttentionRoute };
  /** Localized notification text for an item. */
  format(item: AttentionItem): { title: string; body: string };
  report(error: unknown): void;
  now?: () => number;
};

const INBOX_LIMIT = 200;
export const sessionTag = (desktopId: string, sessionId: string) => `session:${desktopId}:${sessionId}`;
const itemKey = (accountId: string, desktopId: string, attentionId: string) => JSON.stringify([accountId, desktopId, attentionId]);
const sessionKey = (accountId: string, desktopId: string, sessionId: string) => JSON.stringify([accountId, desktopId, sessionId]);

/**
 * The phone side of session attention: deduplicated inbox, in-app toast while
 * visible, system notification while backgrounded, and cleanup when a request
 * is resolved or the conversation is opened.
 */
export class AttentionCenter {
  private accountId?: string;
  private entries: AttentionItem[] = [];
  private toastItem?: AttentionItem;
  /** The kind behind each shown system notification, so resolution clears only stale asks. */
  private readonly presented = new Map<string, AttentionItem["kind"]>();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private revision = 0;
  constructor(private readonly env: AttentionEnvironment) {}
  get items(): readonly AttentionItem[] { return this.entries; }
  get toast() { return this.toastItem; }
  get unread() { return this.entries.reduce((count, item) => count + (item.read ? 0 : 1), 0); }
  /** Changes on every inbox/toast update; a stable snapshot for subscribers. */
  get version() { return this.revision; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.revision += 1; for (const listener of this.listeners) listener(); }
  private now() { return this.env.now?.() ?? Date.now(); }

  async load(accountId: string) {
    const generation = ++this.generation;
    this.accountId = accountId;
    const items = await this.env.store.load(accountId);
    if (generation !== this.generation) return;
    this.entries = sortItems([...items, ...this.entries.filter((item) => item.accountId === accountId)]);
    this.changed();
  }
  reset() { this.generation++; this.accountId = undefined; this.entries = []; this.toastItem = undefined; this.presented.clear(); this.changed(); }

  async receive(desktopId: string, session: MobileSession, attention: MobileAttention, desktopName?: string) {
    const accountId = this.accountId;
    if (!accountId) return;
    const tag = sessionTag(desktopId, session.id);
    if (attention.kind === "resolved") {
      const resolved = this.entries.filter((item) => item.desktopDeviceId === desktopId && item.sessionId === session.id && attentionCategory(item.kind) === "needsAction" && !item.resolved);
      for (const item of resolved) item.resolved = true;
      const kind = this.presented.get(tag);
      if (kind === "approval" || kind === "input") { this.presented.delete(tag); await this.clearNotification(tag); }
      if (this.toastItem && resolved.includes(this.toastItem)) this.toastItem = undefined;
      if (resolved.length) { this.entries = [...this.entries]; await this.persist(resolved); this.changed(); }
      return;
    }
    const key = itemKey(accountId, desktopId, attention.id);
    if (this.entries.some((item) => item.key === key)) return;
    const foreground = this.env.foreground();
    const open = foreground.open?.desktopId === desktopId && foreground.open.sessionId === session.id;
    const item: AttentionItem = {
      key, accountId, desktopDeviceId: desktopId, sessionId: session.id, sessionKey: sessionKey(accountId, desktopId, session.id),
      attentionId: attention.id, kind: attention.kind, ...(attention.requestKind ? { requestKind: attention.requestKind } : {}),
      sessionTitle: session.title, ...(desktopName ? { desktopName } : {}),
      ...(attention.title ? { title: attention.title } : {}), ...(attention.preview ? { preview: attention.preview } : {}),
      ...(attention.errorCode ? { errorCode: attention.errorCode } : {}), ...(attention.image ? { image: true } : {}),
      occurredAt: attention.occurredAt, receivedAt: new Date(this.now()).toISOString(),
      read: foreground.visible && open,
    };
    const dropped = this.entries.length >= INBOX_LIMIT ? this.entries.slice(INBOX_LIMIT - 1) : [];
    this.entries = sortItems([item, ...this.entries.slice(0, INBOX_LIMIT - 1)]);
    const preferences = this.env.preferences();
    const wanted = preferences.enabled && preferences[attentionCategory(item.kind)];
    if (wanted && !item.read) {
      if (foreground.visible) this.toastItem = item;
      else {
        const text = this.env.format(item);
        this.presented.set(tag, item.kind);
        try {
          await this.env.presenter.show({ tag, channel: attentionCategory(item.kind) === "needsAction" ? "attention" : "results", ...text,
            ...(desktopName ? { subtitle: desktopName } : {}), route: { desktopId, sessionId: session.id }, when: Date.parse(item.occurredAt) || this.now() });
        } catch (error) { this.env.report(error); }
      }
    }
    this.changed();
    await this.persist([item]);
    if (dropped.length) await this.env.store.remove(dropped.map((entry) => entry.key)).catch((error: unknown) => this.env.report(error));
  }
  /** The user is looking at this conversation: its items are read and its notification goes. */
  async markSessionRead(desktopId: string, sessionId: string) {
    const items = this.entries.filter((item) => item.desktopDeviceId === desktopId && item.sessionId === sessionId && !item.read);
    for (const item of items) item.read = true;
    if (this.toastItem && items.includes(this.toastItem)) this.toastItem = undefined;
    const tag = sessionTag(desktopId, sessionId);
    if (this.presented.delete(tag)) await this.clearNotification(tag);
    if (items.length) { this.entries = [...this.entries]; this.changed(); await this.persist(items); }
  }
  async markAllRead() {
    const items = this.entries.filter((item) => !item.read);
    for (const item of items) item.read = true;
    this.toastItem = undefined;
    for (const tag of [...this.presented.keys()]) { this.presented.delete(tag); await this.clearNotification(tag); }
    this.entries = [...this.entries]; this.changed();
    await this.persist(items);
  }
  dismissToast() { if (this.toastItem) { this.toastItem = undefined; this.changed(); } }
  /** Drop items of sessions or computers that left the share. */
  forget(predicate: (item: AttentionItem) => boolean) {
    const removed = this.entries.filter(predicate);
    if (!removed.length) return;
    this.entries = this.entries.filter((item) => !predicate(item));
    if (this.toastItem && removed.includes(this.toastItem)) this.toastItem = undefined;
    for (const item of removed) {
      const tag = sessionTag(item.desktopDeviceId, item.sessionId);
      if (this.presented.delete(tag)) void this.clearNotification(tag);
    }
    this.changed();
  }
  private async clearNotification(tag: string) {
    try { await this.env.presenter.clear(tag); } catch (error) { this.env.report(error); }
  }
  private async persist(items: AttentionItem[]) {
    if (!items.length || items[0]!.accountId !== this.accountId) return;
    try { await this.env.store.save(items); } catch (error) { this.env.report(error); }
  }
}

function sortItems(items: AttentionItem[]): AttentionItem[] {
  const unique = new Map(items.map((item) => [item.key, item]));
  return [...unique.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.key.localeCompare(a.key)).slice(0, INBOX_LIMIT);
}
