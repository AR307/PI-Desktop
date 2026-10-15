import { describe, expect, it } from "vitest";
import type { MobileGrant, MobileSession } from "@pi-desktop/shared";
import { dayBucket, needsUser, relativeTime, scopeLabel, sessionStatus, withoutLeadingTitle } from "../src/state/labels";

const t = (key: string, options?: Record<string, unknown>) => `${key}${options?.label ? `:${String(options.label)}` : ""}`;
const grant = (kind: MobileGrant["scope"]["kind"], label: string) => ({ scope: { kind, id: "id", label } });
const session = (extra: Partial<MobileSession>) => ({ id: "s", title: "S", status: "idle", planningState: "inactive", queuedTurnIds: [], ...extra }) as unknown as MobileSession;

describe("display labels", () => {
  it("never shows the desktop's English account label", () => {
    expect(scopeLabel(grant("account", "All projects and sessions"), t)).toBe("scopeAccount");
    expect(scopeLabel(grant("project", "pi-desktop"), t)).toBe("scopeProject:pi-desktop");
    expect(scopeLabel(grant("session", "Fix layout"), t)).toBe("scopeSession:Fix layout");
  });

  it("orders session status by what the user should act on", () => {
    expect(sessionStatus(session({ planningState: "awaiting_approval", status: "idle" }))).toBe("plan");
    expect(sessionStatus(session({ status: "running", attentionCounts: { approvals: 0, inputs: 1 } }))).toBe("input");
    expect(sessionStatus(session({ status: "waiting_permission" }))).toBe("approval");
    expect(sessionStatus(session({ status: "running", queuedTurnIds: ["q"] }))).toBe("running");
    expect(sessionStatus(session({ queuedTurnIds: ["q"] }))).toBe("queued");
    expect(sessionStatus(session({ status: "error" }))).toBe("failed");
    expect(sessionStatus(session({}))).toBe("idle");
    expect(needsUser("plan") && needsUser("input") && !needsUser("running")).toBe(true);
  });

  it("formats compact relative times and inbox day groups", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(relativeTime("2026-10-14T11:58:00Z", "en", now)).toMatch(/2 min/);
    expect(relativeTime("2026-10-14T11:59:50Z", "en", now)).toMatch(/now/);
    expect(relativeTime(undefined, "en", now)).toBe("");
    const local = new Date(now); local.setHours(0, 0, 0, 0);
    expect(dayBucket(new Date(local.getTime() + 1000).toISOString(), now)).toBe("today");
    expect(dayBucket(new Date(local.getTime() - 1000).toISOString(), now)).toBe("yesterday");
    expect(dayBucket(new Date(local.getTime() - 3 * 86_400_000).toISOString(), now)).toBe("earlier");
  });

  it("drops a plan heading that repeats the card title", () => {
    expect(withoutLeadingTitle("# Mobile plan\n\nDo the work.", "Mobile plan")).toBe("Do the work.");
    expect(withoutLeadingTitle("## Other heading\n\nBody", "Mobile plan")).toBe("## Other heading\n\nBody");
    expect(withoutLeadingTitle("Body first\n# Mobile plan", "Mobile plan")).toBe("Body first\n# Mobile plan");
    expect(withoutLeadingTitle("# Mobile plan", undefined)).toBe("# Mobile plan");
  });
});
