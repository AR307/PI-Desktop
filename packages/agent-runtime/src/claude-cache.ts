import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { isClaudeModel } from "@pi-desktop/shared";
import type { ModelConfig } from "./thinking-level.js";

/** Keep non-Claude requests and explicit no-cache calls outside this policy. */
export function claudeCacheOptions(
  model: Pick<Model<Api>, "api" | "id">,
  config: Pick<ModelConfig, "claudeCacheTtl" | "family"> | undefined,
  options?: Pick<SimpleStreamOptions, "cacheRetention">,
): Pick<SimpleStreamOptions, "cacheRetention"> {
  if (model.api !== "anthropic-messages" || !isClaudeModel(model.id, config?.family)) return {};
  return { cacheRetention: options?.cacheRetention ?? (config?.claudeCacheTtl === "1h" ? "long" : "short") };
}
