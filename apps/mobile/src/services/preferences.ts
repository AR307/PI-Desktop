import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "../state/attention";
import { DEFAULT_KEEP_ALIVE_MODE, type KeepAliveMode } from "../state/keep-alive";

/** Per-device conveniences; account data and credentials never live here. */
const NOTIFICATIONS_KEY = "pi.mobile.notifications";
const KEEP_ALIVE_KEY = "pi.mobile.keepAlive";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Preferences fall back to defaults next launch. */ }
}

export function readNotificationPreferences(): NotificationPreferences {
  const raw = read(NOTIFICATIONS_KEY);
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    const value = JSON.parse(raw) as Partial<NotificationPreferences>;
    const flag = (name: keyof NotificationPreferences) => typeof value[name] === "boolean" ? value[name] : DEFAULT_NOTIFICATION_PREFERENCES[name];
    return { enabled: flag("enabled"), needsAction: flag("needsAction"), completed: flag("completed"), failed: flag("failed") };
  } catch { return { ...DEFAULT_NOTIFICATION_PREFERENCES }; }
}
export function writeNotificationPreferences(preferences: NotificationPreferences) { write(NOTIFICATIONS_KEY, JSON.stringify(preferences)); }

export function readKeepAliveMode(): KeepAliveMode {
  const value = read(KEEP_ALIVE_KEY);
  return value === "auto" || value === "always" || value === "off" ? value : DEFAULT_KEEP_ALIVE_MODE;
}
export function writeKeepAliveMode(mode: KeepAliveMode) { write(KEEP_ALIVE_KEY, mode); }

/** When the system last held deliveries back, and when the user last dismissed that notice. */
export type BackgroundDeliveryRecord = { delayedAt?: string; dismissedAt?: string };
const BACKGROUND_DELIVERY_KEY = "pi.mobile.backgroundDelivery";

export function readBackgroundDelivery(): BackgroundDeliveryRecord {
  const raw = read(BACKGROUND_DELIVERY_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as BackgroundDeliveryRecord;
    return { ...(typeof value.delayedAt === "string" ? { delayedAt: value.delayedAt } : {}), ...(typeof value.dismissedAt === "string" ? { dismissedAt: value.dismissedAt } : {}) };
  } catch { return {}; }
}
export function writeBackgroundDelivery(record: BackgroundDeliveryRecord) { write(BACKGROUND_DELIVERY_KEY, JSON.stringify(record)); }
