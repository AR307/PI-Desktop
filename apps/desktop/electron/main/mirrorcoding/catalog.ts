import type {
  MirrorCodingCatalog, MirrorCodingEndpoint, MirrorCodingProviderSync, ModelBinding, ImageGenerationCapability,
} from "@pi-desktop/shared";
import { parseImageCapability } from "@pi-desktop/shared";
import { genericModelConfig, type ModelConfig } from "@pi-desktop/agent-runtime";
import { modelConfigFromModelsDev, type ModelsDevCatalog } from "../models-dev-catalog";

export const ENDPOINTS = {
  "openai-response": { api: "openai-responses", style: "responses", path: "/v1/responses", prefix: "/v1" },
  openai: { api: "openai-completions", style: "chat_completions", path: "/v1/chat/completions", prefix: "/v1" },
  anthropic: { api: "anthropic-messages", style: "anthropic_messages", path: "/v1/messages", prefix: "" },
  gemini: { api: "google-generative-ai", style: "google_generative_ai", path: "/v1beta/models/{model}:generateContent", prefix: "/v1beta" },
} as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_catalog");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_catalog");
  return value;
}

export function parseCatalog(value: unknown): MirrorCodingCatalog {
  const envelope = record(value);
  if (envelope.success !== true) throw new Error("catalog_failed");
  const data = record(envelope.data);
  const user = record(data.user);
  if (!Number.isSafeInteger(user.id) || !Array.isArray(data.groups)) throw new Error("invalid_catalog");
  const supported = record(data.supported_endpoints);
  const supported_endpoints: MirrorCodingCatalog["supported_endpoints"] = {};
  for (const [key, raw] of Object.entries(supported)) {
    const endpoint = record(raw);
    supported_endpoints[key] = { path: string(endpoint.path), method: string(endpoint.method) };
  }
  const groupIds = new Set<string>();
  const groups = data.groups.map((raw) => {
    const group = record(raw);
    const id = string(group.id);
    if (!id || groupIds.has(id) || !Array.isArray(group.models) ||
        typeof group.dynamic_billing !== "boolean" ||
        (group.ratio !== null && (typeof group.ratio !== "number" || !Number.isFinite(group.ratio) || group.ratio < 0))) {
      throw new Error("invalid_catalog");
    }
    groupIds.add(id);
    const seen = new Set<string>();
    const models = group.models.map((rawModel) => {
      const model = record(rawModel);
      const modelId = string(model.id);
      if (!modelId || seen.has(modelId) || !Array.isArray(model.supported_endpoint_types)) throw new Error("invalid_catalog");
      seen.add(modelId);
      return { id: modelId, supported_endpoint_types: model.supported_endpoint_types.map(string),
        ...(model.image ? { image: parseImageCapability(model.image) } : {}) };
    });
    return {
      id, name: string(group.name), description: string(group.description ?? ""),
      ratio: group.ratio as number | null, dynamic_billing: group.dynamic_billing, models,
    };
  });
  return { user: { id: user.id as number, display_name: string(user.display_name) }, groups, supported_endpoints };
}

export function modelMetadata(catalog: ModelsDevCatalog, modelId: string): ModelConfig {
  // Prefer an actual native catalog record over a reseller's same-name entry.
  // Capability lookup never changes the catalog's original request model ID.
  for (const [vendorKey, api] of [
    ["openai", "openai-responses"],
    ["anthropic", "anthropic-messages"],
    ["google", "google-generative-ai"],
  ] as const) {
    const native = catalog.findModel({ vendorKey, modelId });
    if (native?.providerKey === vendorKey) return { ...modelConfigFromModelsDev(native), api };
  }
  const known = catalog.findModel({ modelId });
  return known ? modelConfigFromModelsDev(known) : genericModelConfig(modelId, "");
}

function preferredEndpoint(config: ModelConfig): MirrorCodingEndpoint | undefined {
  if (config.api) {
    const entry = Object.entries(ENDPOINTS).find(([, value]) => value.api === config.api);
    if (entry) return entry[0] as MirrorCodingEndpoint;
  }
  // Published native endpoint metadata, never a model-name heuristic.
  const url = config.baseUrl;
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  if (url.includes("api.openai.com")) return "openai-response";
  return undefined;
}

export function compileCatalog(catalog: MirrorCodingCatalog, modelsDev: ModelsDevCatalog): MirrorCodingProviderSync {
  return {
    accountId: catalog.user.id,
    groups: catalog.groups.map((group) => {
      const routes: Record<string, MirrorCodingEndpoint> = {};
      const imageModels: Record<string, ImageGenerationCapability> = {};
      const models: ModelBinding[] = [];
      for (const model of group.models) {
        const config = modelMetadata(modelsDev, model.id);
        const native = preferredEndpoint(config);
        const candidates = [...new Set([...(native ? [native] : []), ...Object.keys(ENDPOINTS) as MirrorCodingEndpoint[]])];
        const modalities = modelsDev.findModel({ modelId: model.id });
        const supportsChat = model.image ? model.image.supports_chat :
          !modalities?.outputPublished || modalities.modalities.output.includes("text");
        const endpoint = supportsChat ? candidates.find((kind) => {
          const advertised = catalog.supported_endpoints[kind];
          return model.supported_endpoint_types.includes(kind) && advertised?.method === "POST" && advertised.path === ENDPOINTS[kind].path;
        }) : undefined;
        const imageEndpoint = catalog.supported_endpoints["image-generation"];
        if (model.image && imageEndpoint?.method === "POST" && imageEndpoint.path === model.image.generation_path) {
          imageModels[model.id] = model.image;
        }
        if (!endpoint && !imageModels[model.id]) continue;
        if (endpoint) routes[model.id] = endpoint;
        models.push({
          id: model.id, contextWindow: config.contextWindow, contextWindowSource: "catalog",
          maxTokens: config.maxTokens, thinkingLevels: [...config.supportedThinkingLevels ?? []],
          defaultThinkingLevel: config.reasoning ? (config.supportedThinkingLevels?.includes("medium") ? "medium" : config.supportedThinkingLevels?.[0] ?? "off") : "off",
          supportsImages: config.input.includes("image"), supportsDocuments: config.modalities?.input.includes("pdf") ?? false,
        });
      }
      return {
        metadata: {
          accountId: catalog.user.id, groupId: group.id, groupName: group.name,
          description: group.description, ratio: group.dynamic_billing ? null : group.ratio,
          dynamicBilling: group.dynamic_billing, routes, imageModels,
        }, models,
      };
    }),
  };
}
