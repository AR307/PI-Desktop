import type { MobileGrant, MobileModelCatalog, MobileProject, MobileSession, MobileSessionSnapshot, UiMessage } from "@pi-desktop/shared";
import type { RacpClientState } from "@pi-desktop/racp/client";
import type { MobileAuthChallenge, MobileDevice } from "../services/account";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./attention";
import type { DesktopDirectory } from "./directories";
import { DEFAULT_KEEP_ALIVE_MODE } from "./keep-alive";
import type { NotificationSettingsView } from "./notification-runtime";

/** The one immutable snapshot every screen renders from. */
export type MobileView = {
  signedIn: boolean; loading: boolean; error?: string; notice?: string; challenge?: MobileAuthChallenge;
  retryAt?: number; syncError?: string;
  /** Account/sync requests cannot reach MirrorCoding; cached content stays readable. */
  offline?: boolean;
  directories: DesktopDirectory[]; desktopId?: string; projects: MobileProject[];
  grants: MobileGrant[]; devices: MobileDevice[]; grant?: MobileGrant; sessions: MobileSession[];
  selectedId?: string; snapshot?: MobileSessionSnapshot; messages: UiMessage[]; catalog?: MobileModelCatalog;
  connection: RacpClientState; busy: boolean; configuring: boolean; uncertainMessageId?: string;
  notifications: NotificationSettingsView;
};

export const initialView = (): MobileView => ({
  signedIn: false, loading: true, directories: [], projects: [], grants: [], devices: [], sessions: [], messages: [], connection: "disconnected", busy: false, configuring: false,
  notifications: { permission: "unsupported", preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES }, keepAliveMode: DEFAULT_KEEP_ALIVE_MODE, batteryRestricted: false, activeTasks: 0 },
});
