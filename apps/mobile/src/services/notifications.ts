import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { AttentionNotification, AttentionPresenter, AttentionRoute } from "../state/attention";

export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";
/** `manufacturer` names the vendor whose background policy applies; absent off-device. */
export type NotificationState = { permission: NotificationPermission; keepAlive: boolean; batteryRestricted: boolean; manufacturer?: string };
export type SettingsTarget = "notifications" | "battery" | "app";

type NativeNotifications = {
  getState(): Promise<NotificationState>;
  requestPermission(): Promise<NotificationState>;
  requestBackgroundExemption(): Promise<NotificationState>;
  configure(options: { channels: { attention: string; results: string; background: string }; publicText: string }): Promise<void>;
  show(options: AttentionNotification): Promise<void>;
  cancel(options: { tag: string }): Promise<void>;
  setKeepAlive(options: { enabled: boolean; title: string; body: string }): Promise<{ running: boolean }>;
  openSettings(options: { target: SettingsTarget }): Promise<void>;
  addListener(event: "notificationTapped", listener: (route: AttentionRoute) => void): Promise<PluginListenerHandle>;
};

/** Acceptance-only recorder injected by the browser harness; absent from production builds. */
export type NotificationRecorder = {
  shown: AttentionNotification[];
  cleared: string[];
  keepAlive: { enabled: boolean; title: string; body: string }[];
  permission?: NotificationPermission;
  /** Simulated device vendor and battery optimization for the background guidance. */
  manufacturer?: string;
  batteryRestricted?: boolean;
  exemptionRequests?: number;
};

/** The device notification surface: system notifications, keep-alive and settings. */
export interface NotificationBridge extends AttentionPresenter {
  state(): Promise<NotificationState>;
  requestPermission(): Promise<NotificationState>;
  /** System dialog that exempts the app from battery optimization. */
  requestBackgroundExemption(): Promise<NotificationState>;
  configure(text: { attention: string; results: string; background: string; publicText: string }): Promise<void>;
  setKeepAlive(enabled: boolean, title: string, body: string): Promise<void>;
  openSettings(target: SettingsTarget): Promise<void>;
  onTap(listener: (route: AttentionRoute) => void): () => void;
}

const unsupported: NotificationState = { permission: "unsupported", keepAlive: false, batteryRestricted: false };

function nativeBridge(): NotificationBridge {
  const plugin = registerPlugin<NativeNotifications>("MobileNotifications");
  return {
    show: (notification) => plugin.show(notification),
    clear: (tag) => plugin.cancel({ tag }),
    state: () => plugin.getState(),
    requestPermission: () => plugin.requestPermission(),
    requestBackgroundExemption: () => plugin.requestBackgroundExemption(),
    configure: ({ publicText, ...channels }) => plugin.configure({ channels, publicText }),
    setKeepAlive: async (enabled, title, body) => { await plugin.setKeepAlive({ enabled, title, body }); },
    openSettings: (target) => plugin.openSettings({ target }),
    onTap(listener) {
      const handle = plugin.addListener("notificationTapped", listener);
      return () => { void handle.then((value) => value.remove()); };
    },
  };
}

function recordingBridge(recorder: NotificationRecorder): NotificationBridge {
  const taps = new Set<(route: AttentionRoute) => void>();
  (recorder as NotificationRecorder & { tap?: (route: AttentionRoute) => void }).tap = (route) => { for (const listener of taps) listener(route); };
  const state = (): NotificationState => ({ permission: recorder.permission ?? "granted", keepAlive: recorder.keepAlive.at(-1)?.enabled === true,
    batteryRestricted: recorder.batteryRestricted === true, ...(recorder.manufacturer ? { manufacturer: recorder.manufacturer } : {}) });
  return {
    show: async (notification) => { recorder.shown.push(notification); },
    clear: async (tag) => { recorder.cleared.push(tag); },
    state: async () => state(),
    requestPermission: async () => { recorder.permission = "granted"; return state(); },
    requestBackgroundExemption: async () => { recorder.exemptionRequests = (recorder.exemptionRequests ?? 0) + 1; recorder.batteryRestricted = false; return state(); },
    configure: async () => {},
    setKeepAlive: async (enabled, title, body) => { recorder.keepAlive.push({ enabled, title, body }); },
    openSettings: async () => {},
    onTap: (listener) => { taps.add(listener); return () => { taps.delete(listener); }; },
  };
}

const quietBridge: NotificationBridge = {
  show: async () => {}, clear: async () => {}, state: async () => unsupported, requestPermission: async () => unsupported, requestBackgroundExemption: async () => unsupported,
  configure: async () => {}, setKeepAlive: async () => {}, openSettings: async () => {}, onTap: () => () => {},
};

export function createNotificationBridge(recorder?: NotificationRecorder): NotificationBridge {
  if (recorder) return recordingBridge(recorder);
  return Capacitor.isNativePlatform() ? nativeBridge() : quietBridge;
}
