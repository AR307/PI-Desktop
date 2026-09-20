import type { ModelBinding } from "./models.js";

export const MIRRORCODING_AUTH_KIND = "mirrorcoding";
export const MIRRORCODING_ORIGIN = "https://console.mirrorcoding.xyz";

export type MirrorCodingEndpoint = "openai" | "openai-response" | "anthropic" | "gemini";
export type MirrorCodingModel = {
  id: string;
  supported_endpoint_types: string[];
};
export type MirrorCodingGroup = {
  id: string;
  name: string;
  description: string;
  ratio: number | null;
  dynamic_billing: boolean;
  models: MirrorCodingModel[];
};
export type MirrorCodingCatalog = {
  user: { id: number; display_name: string };
  groups: MirrorCodingGroup[];
  supported_endpoints: Record<string, { path: string; method: string }>;
};

/** Public projection only. Credentials are never part of provider storage. */
export type MirrorCodingProvider = {
  accountId: number;
  groupId: string;
  groupName: string;
  description: string;
  ratio: number | null;
  dynamicBilling: boolean;
  routes: Record<string, MirrorCodingEndpoint>;
};
export type MirrorCodingProviderSync = {
  accountId: number | null;
  groups: Array<{ metadata: MirrorCodingProvider; models: ModelBinding[] }>;
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
