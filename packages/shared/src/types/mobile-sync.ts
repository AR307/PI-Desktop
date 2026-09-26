import type { RacpSession, RacpSessionSnapshot, RacpSessionState } from "../racp.js";
import type { ImageGenerationCapability, ImageGenerationState, ImageSessionConfig } from "./images.js";
import type { ModelModalities, SessionThinkingLevel, ThinkingLevel } from "./models.js";
import type { PlanProposal } from "./plans.js";

/** A desktop-owned share. Project membership is resolved at request time. */
export type MobileSyncScope = { kind: "project" | "session"; id: string; label: string };

export type MobileSyncScopeInput =
  | { kind: "project"; projectPath: string }
  | { kind: "project"; projectId: string }
  | { kind: "session"; sessionId: string };

export type MobilePairing = {
  id: string;
  code: string;
  expiresAt: string;
  scope: MobileSyncScope;
};

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
/** Persisted through the host settings boundary; secrets remain in Electron main. */
export type MobileSyncSettings = {
  deviceId: string;
  accountId: string;
  scopes: MobileSyncScope[];
  revokedGrantIds: string[];
};
export type MobileTaskMode = "agent" | "plan" | "goal" | "image";

/** Image capability metadata exposed to the mobile picker. */
export type MobileImageGenerationCapability = ImageGenerationCapability;

export type MobileImageSessionConfig = ImageSessionConfig;
export type MobileImageGenerationState = ImageGenerationState;

export type MobileSession = RacpSession & {
  providerId?: string;
  modelId?: string;
  thinkingLevel?: SessionThinkingLevel;
  groupName?: string;
  taskMode: MobileTaskMode;
  imageConfig?: MobileImageSessionConfig;
  configuration?: MobileSessionConfiguration;
  capabilities: { canPrompt: boolean; canStop: boolean };
};

/** One queued prompt with a bounded text preview, so the phone can manage the queue. */
export type MobileQueuedPrompt = { turnId: string; content: string };

/** Where a context compaction cut the transcript; the divider renders after `throughMessageId`. */
export type MobileCompactionMark = { id: string; throughMessageId: string };

export type MobileSessionSnapshot = Omit<RacpSessionSnapshot, "session"> & {
  session: MobileSession;
  imageJobs: MobileImageGenerationState[];
  plans: PlanProposal[];
  /** Bounded previews of the queued turns, in delivery order. */
  queuedPrompts?: MobileQueuedPrompt[];
  compactions?: MobileCompactionMark[];
};

/**
 * `session/state`: a snapshot without the transcript page, for clients that
 * already hold the transcript (cursor replay or local cache) and only need the
 * live turn/approval/input/plan/image state refreshed.
 */
export type MobileSessionState = Omit<RacpSessionState, "session"> & {
  session: MobileSession;
  imageJobs: MobileImageGenerationState[];
  plans: PlanProposal[];
  queuedPrompts?: MobileQueuedPrompt[];
  compactions?: MobileCompactionMark[];
};
export type MobileModelChoice = {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  source: "mirrorcoding" | "provider";
  groupId?: string;
  groupName?: string;
  groupDescription?: string;
  ratio?: number | null;
  dynamicBilling?: boolean;
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  supportsVision: boolean;
  modalities?: ModelModalities;
  image?: MobileImageGenerationCapability;
};
export type MobileModelCatalog = {
  chat: MobileModelChoice[];
  image: MobileModelChoice[];
};
export type MobileSessionConfiguration = {
  mode: MobileTaskMode;
  /** The configuration used by the currently running turn, when known. */
  current?: {
    mode: MobileTaskMode;
    providerId?: string;
    modelId?: string;
    thinkingLevel?: SessionThinkingLevel;
    imageConfig?: MobileImageSessionConfig;
  };
  /** Persisted configuration read by the next turn. */
  next: {
    mode: MobileTaskMode;
    providerId?: string;
    modelId?: string;
    thinkingLevel?: SessionThinkingLevel;
    imageConfig?: MobileImageSessionConfig;
  };
  chat?: {
    mode: Exclude<MobileTaskMode, "image">;
    /** The saved chat selection remains available while image mode is active. */
    providerId?: string;
    modelId?: string;
    thinkingLevel?: SessionThinkingLevel;
  };
  /** The saved image selection remains available while chat mode is active. */
  image?: {
    mode: "image";
    providerId?: string;
    modelId?: string;
    imageConfig?: MobileImageSessionConfig;
  };
  canConfigure: boolean;
  blockedReason?: "running" | "read_only" | "approval_pending";
  pendingTurn: boolean;
};
export type MobileSessionConfigureInput = {
  mode?: MobileTaskMode;
  providerId?: string;
  modelId?: string;
  thinkingLevel?: SessionThinkingLevel;
  imageConfig?: MobileImageSessionConfig;
};

export type MobileAttachmentRef = {
  id: string;
  name: string;
  kind: "image" | "file";
  mimeType?: string;
  size: number;
};
export type MobileRelayTicket = { ticket: string; expiresAt: string; url: string };

export type MobileRelayEnvelope =
  | { type: "peer.open"; peerId: string; accountId: string; deviceId: string; grants: MobileGrant[] }
  | { type: "peer.frame"; peerId: string; frame: string }
  | { type: "peer.close"; peerId: string; reason?: string }
  | { type: "grants.changed" }
  | { type: "ping" }
  | { type: "pong" };

/** Keep relay attachment frames below common proxy/WebSocket limits. */
export const MOBILE_ATTACHMENT_CHUNK_BYTES = 192 * 1024;

/**
 * Presentation cap per transcript text/value field on the mobile read path,
 * matching the desktop renderer window. Without a cap, one multi-megabyte
 * message makes the snapshot response exceed `maxFrameBytes` and the phone
 * cannot open the session at all. Full content stays reachable per item
 * through `session/item`.
 */
export const MOBILE_ITEM_CONTENT_LIMIT = 64 * 1024;

/**
 * Marker host-core appends to display-capped text fields. Mirrors
 * `DISPLAY_TRUNCATION_MARKER` in `crates/host-core/src/sessions.rs`; clients
 * detect a capped field by this suffix and offer the full-content fetch.
 */
export const TRANSCRIPT_DISPLAY_TRUNCATION_MARKER =
  "\n\n[truncated for display; the full content remains in the transcript]";
