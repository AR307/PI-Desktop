import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { ModelInfo, ModelModality } from "@pi-desktop/shared";
import operationMetadata from "./settings-operation-metadata.json" with { type: "json" };

// Desktop preset IDs predate Pi's namespaces. These aliases select a Pi provider;
// they never change the user's endpoint or on-wire model ID.
export const PI_VENDOR_ALIASES: Record<string, string> = {
  zhipuai: "zai", "zhipuai-coding-plan": "zai-coding-cn",
  "zai-coding-plan": "zai-coding-plan",
};

const publishers: Record<string, string> = {
  claude: "anthropic", gpt: "openai", o1: "openai", o3: "openai", o4: "openai",
  gemini: "google", grok: "xai",
};
const leaf = (id: string) => id.toLowerCase().split("/").at(-1);
const capabilities = (m: Model<Api>) => JSON.stringify([m.input, m.reasoning, m.contextWindow, m.maxTokens, m.thinkingLevelMap]);

/** Exact leaves only; ambiguous deployments remain unknown. No suffix stripping. */
export function relayChatMetadata(models: Models, id: string): Model<Api> | undefined {
  const requested = leaf(id.trim());
  const hits = models.getModelsOfType("chat").filter(model => leaf(model.id) === requested);
  if (!hits.length) return undefined;
  const publisher = publishers[requested?.split(/[-.]/)[0] ?? ""];
  const official = hits.filter(model => model.provider === publisher);
  if (official.length === 1) return official[0];
  return hits.every(model => capabilities(model) === capabilities(hits[0])) ? hits[0] : undefined;
}

/**
 * Display-only compatibility data for speech/embedding/image settings rows that
 * Pi 0.99.1 does not publish. It has no auth, prices, refresh, routing or dispatch.
 * Chat selection and typed Pi operation lookups never consult this data.
 */
export function settingsOperationMetadata(providerId: string, vendor?: string, id?: string): ModelInfo[] {
  const candidates = operationMetadata.filter(row =>
    (!vendor || row.vendor === vendor) && (!id || leaf(row.id) === leaf(id.trim())));
  const unique = new Map<string, typeof candidates>();
  for (const row of candidates) {
    const key = id ? id.trim().toLowerCase() : row.id;
    unique.set(key, [...(unique.get(key) ?? []), row]);
  }
  return [...unique.values()].flatMap(rows => {
    const row = rows[0];
    if (!rows.every(other => JSON.stringify([other.modalities, other.contextWindow, other.maxTokens]) === JSON.stringify([row.modalities, row.contextWindow, row.maxTokens]))) return [];
    const modalities = { input: row.modalities.input as ModelModality[], output: row.modalities.output as ModelModality[] };
    return [{ providerId, modelId: id ?? row.id, displayName: row.name, modalities,
      contextWindow: row.contextWindow, maxTokens: row.maxTokens,
      capabilities: [...new Set([...modalities.input, ...modalities.output])].filter((mode): mode is "text" | "audio" | "video" => mode === "text" || mode === "audio" || mode === "video"),
      source: "bundled" as const }];
  });
}
