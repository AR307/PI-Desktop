import type { MobileSession } from "@pi-desktop/shared";
import type { DesktopDirectory } from "./directories";

export type KeepAliveMode = "auto" | "always" | "off";
export const DEFAULT_KEEP_ALIVE_MODE: KeepAliveMode = "auto";

/** After the last task ends, stay reachable briefly for follow-up asks and results. */
export const KEEP_ALIVE_GRACE_MS = 120_000;

export type KeepAliveInput = {
  mode: KeepAliveMode;
  signedIn: boolean;
  notificationsEnabled: boolean;
  desktops: number;
  activeTasks: number;
  lastWorkEndedAt?: number;
  now: number;
};
export type KeepAliveDecision = { keepAlive: boolean; recheckAt?: number };

/**
 * Whether the app should keep its relay connections alive while backgrounded.
 * Smart mode follows real work on shared computers; always mode trades battery
 * for hearing about tasks started later on the desktop.
 */
export function keepAliveDecision(input: KeepAliveInput): KeepAliveDecision {
  if (input.mode === "off" || !input.signedIn || !input.notificationsEnabled || input.desktops === 0) return { keepAlive: false };
  if (input.mode === "always" || input.activeTasks > 0) return { keepAlive: true };
  if (input.lastWorkEndedAt !== undefined && input.now - input.lastWorkEndedAt < KEEP_ALIVE_GRACE_MS) {
    return { keepAlive: true, recheckAt: input.lastWorkEndedAt + KEEP_ALIVE_GRACE_MS };
  }
  return { keepAlive: false };
}

/** A session the desktop is working on or waiting on the user for. */
export function sessionHasWork(session: MobileSession): boolean {
  return session.status === "running" || session.status === "waiting_permission" || session.planningState === "awaiting_approval"
    || session.queuedTurnIds.length > 0 || session.configuration?.pendingTurn === true
    || (session.attentionCounts?.approvals ?? 0) > 0 || (session.attentionCounts?.inputs ?? 0) > 0;
}

/** The open conversation, when its own live state already shows work the directory row may not yet report. */
export type LiveWork = { desktopId: string; sessionId: string };

/**
 * Tasks on reachable computers; an offline computer cannot deliver anything to
 * wait for. A prompt just sent from the phone counts before the desktop's
 * coalesced row update arrives, so leaving the app right after sending still
 * keeps the connection.
 */
export function activeTaskCount(directories: readonly DesktopDirectory[], live?: LiveWork): number {
  let count = 0;
  for (const row of directories) {
    if (!row.device.online) continue;
    for (const session of row.sessions) {
      if (sessionHasWork(session) || (live !== undefined && live.desktopId === row.desktopDeviceId && live.sessionId === session.id)) count += 1;
    }
  }
  return count;
}
