import type {
  MirrorCodingCatalog, MirrorCodingEndpoint, MirrorCodingImageEndpoint,
  MirrorCodingProviderSync, ModelBinding,
} from "@pi-desktop/shared";
import { genericModelConfig, type ModelConfig } from "@pi-desktop/agent-runtime";
import { modelConfigFromModelsDev, type ModelsDevCatalog } from "../models-dev-catalog";

export const ENDPOINTS = {
  "openai-response": { api: "openai-responses", style: "responses", path: "/v1/responses", prefix: "/v1" },
  openai: { api: "openai-completions", style: "chat_completions", path: "/v1/chat/completions", prefix: "/v1" },
  anthropic: { api: "anthropic-messages", style: "anthropic_messages", path: "/v1/messages", prefix: "" },
  gemini: { api: "google-generative-ai", style: "google_generative_ai", path: "/v1beta/models/{model}:generateContent", prefix: "/v1beta" },
} as const;

export const IMAGE_ENDPOINTS = {
  "image-generation": { path: "/v1/images/generations", prefix: "/v1" },
  "image-edit": { path: "/v1/images/edits", prefix: "/v1" },
} as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_catalog");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_catalog");
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("invalid_catalog");
  }
  return value.map((item) => item.trim());
}

function parseImageCapability(value: unknown): NonNullable<MirrorCodingCatalog["groups"][number]["models"][number]["image"]> | undefined {
  if (value === undefined || value === null) return undefined;
  const image = record(value);
  const maxCount = image.max_count ?? image.maxCount;
  if (maxCount !== undefined && (!Number.isInteger(maxCount) || (maxCount as number) < 1 || (maxCount as number) > 10)) {
    throw new Error("invalid_catalog");
  }
  const supportsChat = image.supports_chat ?? image.supportsChat;
  if (supportsChat !== undefined && typeof supportsChat !== "boolean") throw new Error("invalid_catalog");
  const generationPath = image.generation_path ?? image.generationPath;
  const referencePath = image.reference_path ?? image.referencePath;
  for (const path of [generationPath, referencePath]) {
    if (path !== undefined && (typeof path !== "string" || !path.startsWith("/"))) throw new Error("invalid_catalog");
  }
  return {
    ...(generationPath === undefined ? {} : { generationPath: generationPath as string }),
    ...(referencePath === undefined ? {} : { referencePath: referencePath as string }),
    ...(optionalStringArray(image.sizes) ? { sizes: optionalStringArray(image.sizes) } : {}),
    ...(optionalStringArray(image.qualities) ? { qualities: optionalStringArray(image.qualities) } : {}),
    ...(optionalStringArray(image.aspect_ratios ?? image.aspectRatios) ? { aspectRatios: optionalStringArray(image.aspect_ratios ?? image.aspectRatios) } : {}),
    ...(maxCount === undefined ? {} : { maxCount: maxCount as number }),
    ...(supportsChat === undefined ? {} : { supportsChat: supportsChat as boolean }),
  };
}

export function parseCatalog(value: unknown): MirrorCodingCatalog {
  const envelope = record(value);
  if (envelope.success !== true) throw new Error("catalog_failed");
  const data = record(envelope.data);
  const user = record(data.user);
  if (!Number.isSafeInteger(user.id) || !Array.isArray(data.groups)) throw new Error("invalid_catalog");
  const supported = record(data.supported_endpoints ?? data.supportedEndpoints);
  const supportedEndpoints: MirrorCodingCatalog["supportedEndpoints"] = {};
  for (const [key, raw] of Object.entries(supported)) {
    const endpoint = record(raw);
    supportedEndpoints[key] = { path: string(endpoint.path), method: string(endpoint.method) };
  }
  const groupIds = new Set<string>();
  const groups = data.groups.map((raw) => {
    const group = record(raw);
    const id = string(group.id);
    const dynamicBilling = group.dynamic_billing ?? group.dynamicBilling;
    if (!id || groupIds.has(id) || !Array.isArray(group.models) ||
        typeof dynamicBilling !== "boolean" ||
        (group.ratio !== null && (typeof group.ratio !== "number" || !Number.isFinite(group.ratio) || group.ratio < 0))) {
      throw new Error("invalid_catalog");
    }
    groupIds.add(id);
    const seen = new Set<string>();
    const models = group.models.map((rawModel) => {
      const model = record(rawModel);
      const modelId = string(model.id);
      const endpointTypes = model.supported_endpoint_types ?? model.supportedEndpointTypes;
      if (!modelId || seen.has(modelId) || !Array.isArray(endpointTypes)) throw new Error("invalid_catalog");
      seen.add(modelId);
      return { id: modelId, supportedEndpointTypes: endpointTypes.map(string), image: parseImageCapability(model.image) };
    });
    return {
      id, name: string(group.name), description: string(group.description ?? ""),
      ratio: group.ratio as number | null, dynamicBilling, models,
    };
  });
  return { user: { id: user.id as number, displayName: string(user.display_name ?? user.displayName) }, groups, supportedEndpoints };
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
      const imageRoutes: Record<string, MirrorCodingImageEndpoint> = {};
      const imageCapabilities: NonNullable<MirrorCodingProviderSync["groups"][number]["metadata"]["imageCapabilities"]> = {};
      const models: ModelBinding[] = [];
      for (const model of group.models) {
        const config = modelMetadata(modelsDev, model.id);
        const native = preferredEndpoint(config);
        const candidates = [...new Set([...(native ? [native] : []), ...Object.keys(ENDPOINTS) as MirrorCodingEndpoint[]])];
        const endpoint = candidates.find((kind) => {
          const advertised = catalog.supportedEndpoints[kind];
          return model.supportedEndpointTypes.includes(kind) && advertised?.method === "POST" && advertised.path === ENDPOINTS[kind].path;
        });
        const imageEndpoint = (["image-edit", "image-generation"] as const).find((kind) => {
          const advertised = catalog.supportedEndpoints[kind];
          const declaredPath = kind === "image-edit" ? model.image?.referencePath : model.image?.generationPath;
          return model.supportedEndpointTypes.includes(kind) && advertised?.method === "POST" && advertised.path === IMAGE_ENDPOINTS[kind].path &&
            (!declaredPath || declaredPath === advertised.path);
        });
        if (!endpoint && !imageEndpoint) continue;
        if (endpoint) routes[model.id] = endpoint;
        if (imageEndpoint) {
          imageRoutes[model.id] = imageEndpoint;
          imageCapabilities[model.id] = model.image ?? {};
        }
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
          description: group.description, ratio: group.dynamicBilling ? null : group.ratio,
          dynamicBilling: group.dynamicBilling, routes,
          ...(Object.keys(imageRoutes).length ? { imageRoutes, imageCapabilities } : {}),
        }, models,
      };
    }),
  };
}
