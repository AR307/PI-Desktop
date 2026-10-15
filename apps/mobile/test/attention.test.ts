import { describe, expect, it } from "vitest";
import type { MobileAttention, MobileSession } from "@pi-desktop/shared";
import { AttentionCenter, DEFAULT_NOTIFICATION_PREFERENCES, type AttentionItem, type AttentionNotification, type AttentionRoute, type NotificationPreferences } from "../src/state/attention";
import { activeTaskCount, keepAliveDecision, KEEP_ALIVE_GRACE_MS, sessionHasWork } from "../src/state/keep-alive";
import type { DesktopDirectory } from "../src/state/directories";

const session = (id = "s1", extra: Partial<MobileSession> = {}) => ({ id, title: "Fix layout", status: "idle", planningState: "inactive", queuedTurnIds: [], ...extra }) as unknown as MobileSession;
const attention = (id: string, kind: MobileAttention["kind"], extra: Partial<MobileAttention> = {}): MobileAttention => ({ id, kind, occurredAt: "2026-10-14T10:00:00.000Z", ...extra });

function harness(options: { visible?: boolean; open?: AttentionRoute; preferences?: NotificationPreferences } = {}) {
  const shown: AttentionNotification[] = [];
  const cleared: string[] = [];
  const saved: AttentionItem[] = [];
  const foreground = { visible: options.visible ?? false, open: options.open };
  let clock = Date.parse("2026-10-14T10:00:01.000Z");
  const center = new AttentionCenter({
    presenter: { show: async (notification) => { shown.push(notification); }, clear: async (tag) => { cleared.push(tag); } },
    store: { load: async () => [], save: async (items) => { saved.push(...items); }, remove: async () => {} },
    preferences: () => options.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
    foreground: () => foreground,
    format: (item) => ({ title: `${item.kind} · ${item.sessionTitle}`, body: item.title ?? item.preview ?? "" }),
    report: (error) => { throw error; },
    now: () => (clock += 1000),
  });
  return { center, shown, cleared, saved, foreground };
}

describe("attention delivery on the phone", () => {
  it("raises one system notification per occurrence while backgrounded and routes it to the session", async () => {
    const { center, shown, saved } = harness();
    await center.load("account");
    await center.receive("desk", session(), attention("approval:a1", "approval", { title: "Run npm test" }), "Workstation");
    await center.receive("desk", session(), attention("approval:a1", "approval", { title: "Run npm test" }), "Workstation");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ tag: "session:desk:s1", channel: "attention", route: { desktopId: "desk", sessionId: "s1" }, body: "Run npm test" });
    expect(center.unread).toBe(1);
    expect(saved[0]).toMatchObject({ desktopName: "Workstation", sessionKey: JSON.stringify(["account", "desk", "s1"]) });
  });

  it("clears an answered ask, keeps results, and marks a viewed conversation read", async () => {
    const { center, cleared, shown } = harness();
    await center.load("account");
    await center.receive("desk", session(), attention("input:i1", "input"));
    await center.receive("desk", session(), attention("resolved:e1", "resolved"));
    expect(cleared).toEqual(["session:desk:s1"]);
    expect(center.items[0]).toMatchObject({ kind: "input", resolved: true });
    await center.receive("desk", session(), attention("turn:t1:completed", "completed", { preview: "All green" }));
    expect(shown.at(-1)).toMatchObject({ channel: "results" });
    await center.receive("desk", session(), attention("resolved:e2", "resolved"));
    expect(cleared).toEqual(["session:desk:s1"]);
    await center.markSessionRead("desk", "s1");
    expect(center.unread).toBe(0);
    expect(cleared).toEqual(["session:desk:s1", "session:desk:s1"]);
  });

  it("shows an in-app toast while visible and stays quiet for the open conversation", async () => {
    const { center, shown, foreground } = harness({ visible: true, open: { desktopId: "desk", sessionId: "s1" } });
    await center.load("account");
    await center.receive("desk", session(), attention("turn:t1:failed", "failed", { errorCode: "PROVIDER_ERROR" }));
    expect(shown).toHaveLength(0);
    expect(center.toast).toBeUndefined();
    expect(center.unread).toBe(0);
    foreground.open = undefined;
    await center.receive("desk", session("s2"), attention("turn:t2:completed", "completed"));
    expect(shown).toHaveLength(0);
    expect(center.toast?.sessionId).toBe("s2");
    expect(center.unread).toBe(1);
  });

  it("records but does not interrupt for categories the user turned off", async () => {
    const { center, shown } = harness({ preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, completed: false } });
    await center.load("account");
    await center.receive("desk", session(), attention("turn:t1:completed", "completed"));
    expect(shown).toHaveLength(0);
    expect(center.items).toHaveLength(1);
  });

  it("ignores attention before an account is loaded and forgets items that left the share", async () => {
    const { center, shown } = harness();
    await center.receive("desk", session(), attention("approval:a1", "approval"));
    expect(shown).toHaveLength(0);
    await center.load("account");
    await center.receive("desk", session(), attention("approval:a1", "approval"));
    center.forget((item) => item.sessionId === "s1");
    expect(center.items).toHaveLength(0);
  });
});

describe("background keep-alive policy", () => {
  const base = { mode: "auto" as const, signedIn: true, notificationsEnabled: true, desktops: 1, activeTasks: 0, now: 1_000_000 };
  it("keeps the connection while work is running and briefly after it ends", () => {
    expect(keepAliveDecision({ ...base, activeTasks: 2 })).toEqual({ keepAlive: true });
    expect(keepAliveDecision({ ...base, lastWorkEndedAt: base.now - 1_000 })).toEqual({ keepAlive: true, recheckAt: base.now - 1_000 + KEEP_ALIVE_GRACE_MS });
    expect(keepAliveDecision({ ...base, lastWorkEndedAt: base.now - KEEP_ALIVE_GRACE_MS })).toEqual({ keepAlive: false });
  });
  it("honors always/off, sign-out, disabled notifications and no paired computers", () => {
    expect(keepAliveDecision({ ...base, mode: "always" }).keepAlive).toBe(true);
    expect(keepAliveDecision({ ...base, mode: "off", activeTasks: 1 }).keepAlive).toBe(false);
    expect(keepAliveDecision({ ...base, signedIn: false, mode: "always" }).keepAlive).toBe(false);
    expect(keepAliveDecision({ ...base, notificationsEnabled: false, activeTasks: 1 }).keepAlive).toBe(false);
    expect(keepAliveDecision({ ...base, desktops: 0, mode: "always" }).keepAlive).toBe(false);
  });
  it("counts running, queued, waiting and image work only on reachable computers", () => {
    expect(sessionHasWork(session("a", { status: "running" } as Partial<MobileSession>))).toBe(true);
    expect(sessionHasWork(session("b", { queuedTurnIds: ["q"] } as Partial<MobileSession>))).toBe(true);
    expect(sessionHasWork(session("c", { attentionCounts: { approvals: 0, inputs: 1 } }))).toBe(true);
    expect(sessionHasWork(session("d", { configuration: { pendingTurn: true } } as unknown as Partial<MobileSession>))).toBe(true);
    expect(sessionHasWork(session("e"))).toBe(false);
    const row = (online: boolean) => ({ device: { online }, sessions: [session("a", { status: "running" } as Partial<MobileSession>), session("e")] }) as unknown as DesktopDirectory;
    expect(activeTaskCount([row(true), row(false)])).toBe(1);
  });
  it("counts a prompt the phone just sent before the desktop row reports it", () => {
    const row = (online: boolean) => ({ desktopDeviceId: "desk", device: { online }, sessions: [session("e")] }) as unknown as DesktopDirectory;
    const live = { desktopId: "desk", sessionId: "e" };
    expect(activeTaskCount([row(true)])).toBe(0);
    expect(activeTaskCount([row(true)], live)).toBe(1);
    expect(activeTaskCount([row(true)], { ...live, desktopId: "other" })).toBe(0);
    expect(activeTaskCount([row(false)], live)).toBe(0);
  });
});
