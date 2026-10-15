import { describe, expect, it } from "vitest";
import { assertMirrorCodingFast, withMirrorCodingFast } from "./mirrorcoding-fast.js";
import type { Model } from "@earendil-works/pi-ai";
import type { RuntimeProviderConfig } from "./provider-binding.js";
import { classifyAgentError } from "./agent-errors.js";

const provider: RuntimeProviderConfig = { id: "mc", name: "MC", authKind: "mirrorcoding", modelId: "fixture", apiKey: "test", fastAvailable: true, fast: true, supportsReasoning: false, supportedThinkingLevels: ["off"] };
const model: Model<"openai-completions"> = { id: "fixture", name: "fixture", api: "openai-completions", provider: "openai", baseUrl: "http://localhost/v1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096 };

describe("MC Fast final payload", () => {
  it("runs after async extension hooks and retains reasoning and limits", async () => {
    const options = withMirrorCodingFast({ onPayload: async () => ({ model: "fixture", reasoning_effort: "max", max_tokens: 8192, service_tier: "priority", custom: true }) }, provider);
    expect(await options.onPayload?.({}, model)).toEqual({ model: "fixture", reasoning_effort: "max", max_tokens: 8192, service_tier: "fast", custom: true });
  });
  it("omits service tier when off, and does not change ordinary providers", async () => {
    const payload = { service_tier: "fast", model: "fixture" };
    expect(await withMirrorCodingFast({}, { ...provider, fast: false }).onPayload?.(payload, model)).toEqual({ model: "fixture" });
    expect(payload.service_tier).toBe("fast");
    const options = { onPayload: () => payload };
    expect(withMirrorCodingFast(options, { ...provider, authKind: "api_key_and_base_url" })).toBe(options);
  });
  it("refuses explicit Fast without the selected route capability", () => {
    expect(() => assertMirrorCodingFast({ ...provider, fastAvailable: false }, true)).toThrow("PI_FAST_UNAVAILABLE");
    expect(() => assertMirrorCodingFast({ ...provider, authKind: "none" }, true)).toThrow("PI_FAST_UNAVAILABLE");
    expect(() => assertMirrorCodingFast({ ...provider, fastAvailable: false }, false)).not.toThrow();
  });
  it.each(["400: {\"code\":\"pi_fast_unavailable\"}", "400: {\"code\":\"invalid_service_tier\"}", "403: {\"code\":\"model_or_group_unavailable\"}", "402: balance required"])("does not retry a contract or balance rejection: %s", message => {
    expect(classifyAgentError(message).retriable).toBe(false);
  });
});
