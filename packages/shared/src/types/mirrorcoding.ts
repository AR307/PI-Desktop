import type { ModelBinding } from "./models.js";

export const MIRRORCODING_AUTH_KIND = "mirrorcoding" as const;
export const MIRRORCODING_ORIGIN = "https://console.mirrorcoding.xyz" as const;

export type MirrorCodingEndpoint = "openai" | "openai-response" | "anthropic" | "gemini";
export type MirrorCodingImageEndpoint = "image-generation" | "image-edit";

export type MirrorCodingImageCapability = {
  generationPath?: string;
  referencePath?: string;
  sizes?: string[];
  qualities?: string[];
  aspectRatios?: string[];
  maxCount?: number;
  supportsChat?: boolean;
};

export type MirrorCodingModel = {
  id: string;
  supportedEndpointTypes: string[];
  image?: MirrorCodingImageCapability;
};

export type MirrorCodingGroup = {
  id: string;
  name: string;
  description: string;
  ratio: number | null;
  dynamicBilling: boolean;
  models: MirrorCodingModel[];
};

export type MirrorCodingCatalog = {
  user: { id: number; displayName: string };
  groups: MirrorCodingGroup[];
  supportedEndpoints: Record<string, { path: string; method: string }>;
};

export type MirrorCodingProvider = {
  accountId: number;
  groupId: string;
  groupName: string;
  description: string;
  ratio: number | null;
  dynamicBilling: boolean;
  routes: Record<string, MirrorCodingEndpoint>;
  imageRoutes?: Record<string, MirrorCodingImageEndpoint>;
  imageCapabilities?: Record<string, MirrorCodingImageCapability>;
};

export type MirrorCodingProviderGroup = {
  metadata: MirrorCodingProvider;
  models: ModelBinding[];
};

export type MirrorCodingProviderSync = {
  accountId: number | null;
  groups: MirrorCodingProviderGroup[];
};

export type MirrorCodingAccountState = {
  status: "signed_out" | "authorizing" | "connected" | "reauthorize";
  account?: MirrorCodingCatalog["user"];
  authorizationExpiresAt?: number;
  sync: "idle" | "syncing" | "success" | "error";
  syncedAt?: number;
  error?: string;
  catalog?: MirrorCodingCatalog;
  pendingRevocation: boolean;
};
