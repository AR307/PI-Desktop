import { describe, expect, it } from "vitest";
import type { MobileAttention, MobileSession } from "@pi-desktop/shared";
import { backgroundNotice, backgroundVendor, deliveredLate, freezesInBackground, LATE_DELIVERY_MS, RESUME_WINDOW_MS } from "../src/state/background-delivery";
import { NotificationRuntime } from "../src/state/notification-runtime";
import type { NotificationBridge, NotificationState } from "../src/services/notifications";
import type { AttentionNotification } from "../src/state/attention";
import type { DesktopDirectory } from "../src/state/directories";

const minute = 60_000;
const hidden = Date.parse("2026-10-15T10:00:00.000Z");
const at = (offset: number) => new Date(hidden + offset).toISOString();

describe("vendor background policy", () => {
  it("groups manufacturers by the background switch they use", () => {
    expect(["OPPO", "OnePlus", "realme"].map(backgroundVendor)).toEqual(["oppo", "oppo", "oppo"]);
    expect(["vivo", "iQOO"].map(backgroundVendor)).toEqual(["vivo", "vivo"]);
    expect(["Xiaomi", "Redmi", "POCO"].map(backgroundVendor)).toEqual(["xiaomi", "xiaomi", "xiaomi"]);
    expect(["HUAWEI", "HONOR"].map(backgroundVendor)).toEqual(["huawei", "huawei"]);
    expect(backgroundVendor("samsung")).toBe("samsung");
    expect(backgroundVendor("Google")).toBe("other");
    expect(backgroundVendor(undefined)).toBe("other");
    expect(freezesInBackground("oppo") && freezesInBackground("vivo") && !freezesInBackground("samsung") && !freezesInBackground("other")).toBe(true);
  });
});

describe("late background delivery", () => {
  const base = { occurredAt: at(minute), clockOffsetMs: 0, visible: false, hiddenSince: hidden, keptAlive: true };
  it("flags attention a kept-alive app handled minutes late, hidden or in the resume burst", () => {
    expect(deliveredLate({ ...base, now: hidden + minute + LATE_DELIVERY_MS + 1 })).toBe(true);
    const resumedAt = hidden + 10 * minute;
    expect(deliveredLate({ ...base, visible: true, resumedAt, now: resumedAt + 2_000 })).toBe(true);
  });
  it("ignores prompt deliveries, normal foreground use and unknown clocks", () => {
    expect(deliveredLate({ ...base, now: hidden + minute + 5_000 })).toBe(false);
    const resumedAt = hidden + 10 * minute;
    expect(deliveredLate({ ...base, visible: true, resumedAt, now: resumedAt + RESUME_WINDOW_MS + 1 })).toBe(false);
    expect(deliveredLate({ occurredAt: base.occurredAt, visible: false, hiddenSince: hidden, keptAlive: true, now: hidden + 10 * minute })).toBe(false);
  });
  it("does not blame the system when nothing kept the app alive or the event preceded leaving", () => {
    expect(deliveredLate({ ...base, keptAlive: false, now: hidden + 10 * minute })).toBe(false);
    expect(deliveredLate({ ...base, occurredAt: at(-minute), now: hidden + 10 * minute })).toBe(false);
  });
  it("places the desktop time on the phone clock before judging", () => {
    // The desktop runs ten minutes ahead: its event at +11 min happened at +1 min here.
    const skewed = { ...base, occurredAt: at(11 * minute), clockOffsetMs: 10 * minute };
    expect(deliveredLate({ ...skewed, now: hidden + minute + 5_000 })).toBe(false);
    expect(deliveredLate({ ...skewed, now: hidden + 5 * minute })).toBe(true);
  });
});

describe("background notice", () => {
  const base = { vendor: "oppo" as const, notificationsEnabled: true, permission: "granted", keepAliveOff: false };
  it("guides up front on freezing vendors until the user dismisses it", () => {
    expect(backgroundNotice(base)).toBe("setup");
    expect(backgroundNotice({ ...base, dismissedAt: at(0) })).toBeUndefined();
    expect(backgroundNotice({ ...base, vendor: "other" })).toBeUndefined();
    expect(backgroundNotice({ ...base, permission: "prompt" })).toBeUndefined();
  });
  it("reports held-back deliveries until dismissed after them, on any vendor", () => {
    const delayed = { ...base, vendor: "other" as const, delayedAt: at(5 * minute) };
    expect(backgroundNotice(delayed)).toBe("delayed");
    expect(backgroundNotice({ ...delayed, dismissedAt: at(minute) })).toBe("delayed");
    expect(backgroundNotice({ ...delayed, dismissedAt: at(6 * minute) })).toBeUndefined();
  });
  it("stays quiet when notifications or the background connection are off", () => {
    expect(backgroundNotice({ ...base, notificationsEnabled: false, delayedAt: at(0) })).toBeUndefined();
    expect(backgroundNotice({ ...base, keepAliveOff: true, delayedAt: at(0) })).toBeUndefined();
  });
});

describe("notification runtime", () => {
  const session = { id: "s1", title: "Long task", status: "running", planningState: "inactive", queuedTurnIds: [] } as unknown as MobileSession;
  const directory = { desktopDeviceId: "desk", device: { online: true }, sessions: [session] } as unknown as DesktopDirectory;
  const completed: MobileAttention = { id: "turn:t1:completed", kind: "completed", occurredAt: at(2 * minute) };
  function runtime(manufacturer = "OPPO") {
    let clock = hidden - 1_000;
    const shown: AttentionNotification[] = [];
    let state: NotificationState = { permission: "granted", keepAlive: false, batteryRestricted: true, manufacturer };
    const bridge: NotificationBridge = {
      show: async (notification) => { shown.push(notification); }, clear: async () => {},
      state: async () => state, requestPermission: async () => state,
      requestBackgroundExemption: async () => (state = { ...state, batteryRestricted: false }),
      configure: async () => {}, setKeepAlive: async () => {}, openSettings: async () => {}, onTap: () => () => {},
    };
    const target = new NotificationRuntime({
      bridge, store: { load: async () => [], save: async () => {}, remove: async () => {} },
      format: (item) => ({ title: item.sessionTitle, body: "" }), keepAliveText: () => ({ title: "", body: "" }),
      snapshot: () => ({ signedIn: true, directories: [directory] }), open: () => undefined,
      changed: () => {}, report: (error) => { throw error; }, now: () => clock,
    });
    return { target, shown, tick: (to: number) => { clock = to; }, setState: (patch: Partial<NotificationState>) => { state = { ...state, ...patch }; } };
  }
  it("records a delay when the kept-alive app handles attention only on resume", async () => {
    const { target, tick } = runtime();
    await target.refreshState();
    expect(target.view.vendor).toBe("oppo");
    target.update();
    tick(hidden); target.setVisible(false);
    tick(hidden + 20 * minute); target.setVisible(true);
    tick(hidden + 20 * minute + 1_500);
    await target.receive("desk", session, completed, "Laptop", 0);
    expect(target.view.backgroundDelayedAt).toBe(at(20 * minute + 1_500));
    target.dismissBackgroundNotice();
    expect(target.view.backgroundNoticeDismissedAt).toBe(at(20 * minute + 1_500));
  });
  it("records nothing when the background delivery was prompt", async () => {
    const { target, shown, tick } = runtime("Google");
    await target.attention.load("account");
    await target.refreshState();
    target.update();
    tick(hidden); target.setVisible(false);
    tick(hidden + 2 * minute + 3_000);
    await target.receive("desk", session, completed, "Laptop", 0);
    expect(target.view.backgroundDelayedAt).toBeUndefined();
    expect(shown).toHaveLength(1);
  });
  it("asks the system for the battery exemption and reflects the answer", async () => {
    const { target } = runtime();
    await target.refreshState();
    expect(target.view.batteryRestricted).toBe(true);
    await target.requestBackgroundExemption();
    expect(target.view.batteryRestricted).toBe(false);
  });
  it("re-reads the system state when a dialog over the app closes", async () => {
    const { target, setState } = runtime();
    await target.refreshState();
    expect(target.view.batteryRestricted).toBe(true);
    // The exemption dialog answered while the app stayed visible behind it.
    setState({ batteryRestricted: false });
    target.setVisible(true);
    await new Promise((done) => setTimeout(done, 0));
    expect(target.view.batteryRestricted).toBe(false);
  });
});
