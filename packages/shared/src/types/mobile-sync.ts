import type { RacpSession, RacpSessionSnapshot } from "../racp.js";
import type { ImageGenerationState, ImageSessionConfig } from "./images.js";
import type { PlanProposal } from "./plans.js";

/** An explicit desktop-owned share; project membership is resolved on every use. */
export type MobileSyncScope = { kind: "project" | "session"; id: string; label: string };
export type MobileSyncScopeInput = { kind: "project"; projectPath: string } | { kind: "project"; projectId: string } | { kind: "session"; sessionId: string };
export type MobilePairing = { id: string; code: string; expiresAt: string; scope: MobileSyncScope };
export type MobileGrant = {
  id: string;
  accountId: string;
  desktopDeviceId: string;
  mobileDeviceId: string;
  mobileDeviceName: string;
  scope: MobileSyncScope;
  createdAt: string;
};
export type MobileSyncStatus = {
  status: "signed_out" | "connecting" | "online" | "offline" | "error";
  deviceId?: string;
  pairings: MobilePairing[];
  grants: MobileGrant[];
  error?: string;
};
/** Stored by Rust through the existing settings boundary. No account tokens. */
export type MobileSyncSettings = {
  deviceId: string;
  accountId: string;
  scopes: MobileSyncScope[];
  revokedGrantIds: string[];
};
export type MobileSession = RacpSession & {
  providerId?: string;
  modelId?: string;
  groupName?: string;
  taskMode: "agent" | "plan" | "goal" | "image";
  imageConfig?: ImageSessionConfig;
  capabilities: { canPrompt: boolean; canStop: boolean };
};
export type MobileSessionSnapshot = Omit<RacpSessionSnapshot, "session"> & {
  session: MobileSession;
  imageJobs: ImageGenerationState[];
  plans: PlanProposal[];
};
export type MobileAttachmentRef = { id: string; name: string; kind: "image" | "file"; mimeType?: string; size: number };
export type MobileRelayTicket = { ticket: string; expiresAt: string; url: string };
export type MobileRelayEnvelope =
  | { type: "peer.open"; peerId: string; accountId: string; deviceId: string; grants: MobileGrant[] }
  | { type: "peer.frame"; peerId: string; frame: string }
  | { type: "peer.close"; peerId: string; reason?: string }
  | { type: "grants.changed" }
  | { type: "ping" }
  | { type: "pong" };

/** Chunking keeps the relay within normal WebSocket frame sizes. */
export const MOBILE_ATTACHMENT_CHUNK_BYTES = 192 * 1024;
