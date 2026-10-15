import type { MobileGrant, MobileSession } from "@pi-desktop/shared";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Share scopes in the phone's language. Account scopes carry a label written
 * by the desktop (always English), so the phone never displays it verbatim.
 */
export function scopeLabel(grant: Pick<MobileGrant, "scope">, t: Translate): string {
  if (grant.scope.kind === "account") return t("scopeAccount");
  return t(grant.scope.kind === "project" ? "scopeProject" : "scopeSession", { label: grant.scope.label });
}

export type SessionStatusKind = "approval" | "plan" | "input" | "running" | "queued" | "failed" | "idle";

/** One status per session row, in the order the user should act on it. */
export function sessionStatus(session: MobileSession): SessionStatusKind {
  if (session.planningState === "awaiting_approval") return "plan";
  if ((session.attentionCounts?.inputs ?? 0) > 0) return "input";
  if ((session.attentionCounts?.approvals ?? 0) > 0 || session.status === "waiting_permission") return "approval";
  // An image job keeps `pendingTurn` without an Agent Host turn; a queue alone is not running.
  if (session.status === "running" || (session.configuration?.pendingTurn === true && session.queuedTurnIds.length === 0)) return "running";
  if (session.queuedTurnIds.length > 0) return "queued";
  if (session.status === "error") return "failed";
  return "idle";
}

export const needsUser = (status: SessionStatusKind) => status === "approval" || status === "plan" || status === "input";

/** Compact relative time for list rows; older entries fall back to a date. */
export function relativeTime(iso: string | undefined, locale: string, now = Date.now()): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (abs < 45) return format.format(0, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(time);
}

/** Inbox grouping: today, yesterday, then everything older. */
export function dayBucket(iso: string, now = Date.now()): "today" | "yesterday" | "earlier" {
  const date = new Date(iso);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (date.getTime() >= start.getTime()) return "today";
  if (date.getTime() >= start.getTime() - 86_400_000) return "yesterday";
  return "earlier";
}

/** Drop a plan's leading heading when the card already shows the same title. */
export function withoutLeadingTitle(markdown: string, title: string | undefined): string {
  const match = /^\s*#{1,6}[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(markdown);
  if (!title || !match || match[1]!.trim() !== title.trim()) return markdown;
  return markdown.slice(match[0].length).replace(/^\s*\n/, "");
}
