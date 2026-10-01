import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { RuntimeProviderConfig } from "./provider-binding.js";

export function assertMirrorCodingFast(provider: RuntimeProviderConfig, fast: boolean): void {
  if (fast && (provider.authKind !== "mirrorcoding" || !provider.fastAvailable)) {
    throw Object.assign(new Error("PI_FAST_UNAVAILABLE: Fast is not available for the selected model, group and endpoint. Choose a Fast-capable delegation model or explicitly request fast:false."), {
      errorCode: "PI_FAST_UNAVAILABLE",
    });
  }
}

/** Run after extension hooks; MC owns conversion to the upstream service tier. */
export function withMirrorCodingFast(options: SimpleStreamOptions, provider: RuntimeProviderConfig): SimpleStreamOptions {
  if (provider.authKind !== "mirrorcoding") return options;
  const fast = provider.fast === true;
  assertMirrorCodingFast(provider, fast);
  return { ...options, onPayload: async (payload, model) => {
    const current = await options.onPayload?.(payload, model) ?? payload;
    if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("invalid_model_request");
    const next = { ...current } as Record<string, unknown>;
    delete next.service_tier;
    if (fast) next.service_tier = "fast";
    return next;
  } };
}
