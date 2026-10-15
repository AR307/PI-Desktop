/**
 * Background delivery on Android vendors that pause apps beyond stock Android.
 * ColorOS, OriginOS, HyperOS and EMUI/MagicOS can freeze an app in the
 * background despite its foreground service until the user allows background
 * activity, so attention arrives only when the app is opened again.
 */
export type BackgroundVendor = "oppo" | "vivo" | "xiaomi" | "huawei" | "samsung" | "other";

const VENDORS: Array<[BackgroundVendor, readonly string[]]> = [
  ["oppo", ["oppo", "oneplus", "realme"]],
  ["vivo", ["vivo", "iqoo"]],
  ["xiaomi", ["xiaomi", "redmi", "poco"]],
  ["huawei", ["huawei", "honor"]],
  ["samsung", ["samsung"]],
];

export function backgroundVendor(manufacturer: string | undefined): BackgroundVendor {
  const name = manufacturer?.trim().toLowerCase() ?? "";
  return VENDORS.find(([, names]) => names.includes(name))?.[0] ?? "other";
}

/** Vendors whose background freezer is known to hold back a foreground service app. */
export const freezesInBackground = (vendor: BackgroundVendor) => vendor === "oppo" || vendor === "vivo" || vendor === "xiaomi" || vendor === "huawei";

/** An attention this much older than its handling was held back, not merely slow. */
export const LATE_DELIVERY_MS = 90_000;
/** Attention handled this soon after returning to the foreground is part of the resume burst. */
export const RESUME_WINDOW_MS = 20_000;

export type DeliveryTiming = {
  /** Desktop clock time of the event and desktop-minus-phone clock offset; unknown offsets never count. */
  occurredAt: string;
  clockOffsetMs?: number;
  now: number;
  visible: boolean;
  hiddenSince?: number;
  resumedAt?: number;
  /** The background connection was kept alive while the app was away. */
  keptAlive: boolean;
};

/**
 * Whether an attention reached the app long after it happened while the app
 * was kept alive in the background. With a live connection, a backgrounded app
 * handles attention within seconds; a long delay that ends while still hidden
 * or in the burst right after resume means the system paused the app.
 */
export function deliveredLate(timing: DeliveryTiming): boolean {
  if (timing.clockOffsetMs === undefined || !timing.keptAlive || timing.hiddenSince === undefined) return false;
  const occurred = Date.parse(timing.occurredAt) - timing.clockOffsetMs;
  if (!Number.isFinite(occurred) || occurred < timing.hiddenSince) return false;
  if (timing.now - occurred < LATE_DELIVERY_MS) return false;
  if (!timing.visible) return true;
  return timing.resumedAt !== undefined && timing.resumedAt >= occurred && timing.now - timing.resumedAt <= RESUME_WINDOW_MS;
}

export type BackgroundNoticeInput = {
  vendor: BackgroundVendor;
  notificationsEnabled: boolean;
  permission: string;
  keepAliveOff: boolean;
  delayedAt?: string;
  dismissedAt?: string;
};

/**
 * Which background notice to show: `delayed` once deliveries were actually held
 * back (until dismissed after that), or `setup` up front on a vendor known to
 * freeze background apps (until first dismissed).
 */
export function backgroundNotice(input: BackgroundNoticeInput): "delayed" | "setup" | undefined {
  if (!input.notificationsEnabled || input.keepAliveOff) return undefined;
  const dismissed = input.dismissedAt ? Date.parse(input.dismissedAt) : Number.NaN;
  if (input.delayedAt && !(dismissed >= Date.parse(input.delayedAt))) return "delayed";
  if (freezesInBackground(input.vendor) && input.permission === "granted" && !input.dismissedAt) return "setup";
  return undefined;
}
