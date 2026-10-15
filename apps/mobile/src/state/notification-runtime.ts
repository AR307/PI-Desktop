import type { NotificationBridge, NotificationPermission, SettingsTarget } from "../services/notifications";
import { readKeepAliveMode, readNotificationPreferences, writeKeepAliveMode, writeNotificationPreferences } from "../services/preferences";
import { AttentionCenter, type AttentionEnvironment, type AttentionItem, type AttentionRoute, type AttentionStore, type NotificationPreferences } from "./attention";
import type { DesktopDirectory } from "./directories";
import { activeTaskCount, keepAliveDecision, type KeepAliveMode, type LiveWork } from "./keep-alive";

export type NotificationSettingsView = {
  permission: NotificationPermission;
  preferences: NotificationPreferences;
  keepAliveMode: KeepAliveMode;
  batteryRestricted: boolean;
  /** Tasks currently keeping the background connection alive. */
  activeTasks: number;
};

export type NotificationRuntimeDependencies = {
  bridge: NotificationBridge;
  store: AttentionStore;
  format(item: AttentionItem): { title: string; body: string };
  keepAliveText(activeTasks: number): { title: string; body: string };
  snapshot(): { signedIn: boolean; directories: readonly DesktopDirectory[]; live?: LiveWork };
  open(): AttentionRoute | undefined;
  changed(view: NotificationSettingsView): void;
  report(error: unknown): void;
  now?: () => number;
};

/**
 * Device notification state: preferences, OS permission, the attention inbox
 * and the background keep-alive decision, which follows shared desktop work.
 */
export class NotificationRuntime {
  readonly attention: AttentionCenter;
  private value: NotificationSettingsView;
  private visible = true;
  private hadWork = false;
  private lastWorkEndedAt?: number;
  private applied?: string;
  private recheck?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private readonly deps: NotificationRuntimeDependencies) {
    this.value = { permission: "unsupported", preferences: readNotificationPreferences(), keepAliveMode: readKeepAliveMode(), batteryRestricted: false, activeTasks: 0 };
    const environment: AttentionEnvironment = {
      presenter: deps.bridge, store: deps.store, format: deps.format, report: deps.report,
      preferences: () => this.value.preferences,
      foreground: () => ({ visible: this.visible, ...(deps.open() ? { open: deps.open() } : {}) }),
      ...(deps.now ? { now: deps.now } : {}),
    };
    this.attention = new AttentionCenter(environment);
  }
  get view() { return this.value; }
  private now() { return this.deps.now?.() ?? Date.now(); }
  private set(patch: Partial<NotificationSettingsView>) { this.value = { ...this.value, ...patch }; this.deps.changed(this.value); }

  async refreshState() {
    try {
      const state = await this.deps.bridge.state();
      if (this.disposed) return;
      this.set({ permission: state.permission, batteryRestricted: state.batteryRestricted });
    } catch (error) { this.deps.report(error); }
    this.update();
  }
  async requestPermission() {
    const state = await this.deps.bridge.requestPermission();
    this.set({ permission: state.permission, batteryRestricted: state.batteryRestricted });
    this.update();
  }
  async openSettings(target: SettingsTarget) { await this.deps.bridge.openSettings(target); }
  /** Localized channel names and lock-screen text; the keep-alive text follows on its next update. */
  async configure(text: { attention: string; results: string; background: string; publicText: string }) {
    try { await this.deps.bridge.configure(text); } catch (error) { this.deps.report(error); }
    this.applied = undefined;
    this.update();
  }
  setPreferences(preferences: NotificationPreferences) {
    writeNotificationPreferences(preferences);
    this.set({ preferences });
    this.update();
  }
  setKeepAliveMode(mode: KeepAliveMode) {
    writeKeepAliveMode(mode);
    this.set({ keepAliveMode: mode });
    this.update();
  }
  /** The app moved in front of or behind the user. */
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) {
      const open = this.deps.open();
      if (open) void this.attention.markSessionRead(open.desktopId, open.sessionId);
      void this.refreshState();
    } else this.update();
  }
  /** Re-evaluate the keep-alive decision after directory, account or preference changes. */
  update() {
    if (this.disposed) return;
    const { signedIn, directories, live } = this.deps.snapshot();
    const activeTasks = signedIn ? activeTaskCount(directories, live) : 0;
    const now = this.now();
    if (this.hadWork && activeTasks === 0) this.lastWorkEndedAt = now;
    if (activeTasks > 0) this.lastWorkEndedAt = undefined;
    this.hadWork = activeTasks > 0;
    if (activeTasks !== this.value.activeTasks) this.set({ activeTasks });
    const decision = keepAliveDecision({
      mode: this.value.keepAliveMode, signedIn,
      notificationsEnabled: this.value.preferences.enabled && this.value.permission !== "denied",
      desktops: directories.length, activeTasks, ...(this.lastWorkEndedAt !== undefined ? { lastWorkEndedAt: this.lastWorkEndedAt } : {}), now,
    });
    clearTimeout(this.recheck); this.recheck = undefined;
    if (decision.recheckAt !== undefined) this.recheck = setTimeout(() => this.update(), Math.max(0, decision.recheckAt - now) + 50);
    const text = this.deps.keepAliveText(activeTasks);
    const applied = JSON.stringify([decision.keepAlive, text.title, text.body]);
    if (applied === this.applied) return;
    this.applied = applied;
    void this.deps.bridge.setKeepAlive(decision.keepAlive, text.title, text.body).catch((error: unknown) => this.deps.report(error));
  }
  /** Account sign-out: no inbox, no keep-alive. */
  reset() {
    this.attention.reset();
    this.hadWork = false; this.lastWorkEndedAt = undefined;
    this.update();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.recheck);
    void this.deps.bridge.setKeepAlive(false, "", "").catch(() => undefined);
  }
}
