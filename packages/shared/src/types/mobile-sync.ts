import type { RacpSession, RacpSessionSnapshot } from "../racp.js";
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

export type MobileSessionSnapshot = Omit<RacpSessionSnapshot, "session"> & {
  session: MobileSession;
  imageJobs: MobileImageGenerationState[];
  plans: PlanProposal[];
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
