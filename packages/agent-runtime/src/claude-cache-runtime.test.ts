import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { normalizeContext } from "@earendil-works/pi-ai";
import { DesktopAgentRuntime } from "./runtime.js";
import { genericModelConfig, modelConfigWithBinding } from "./model-capabilities.js";
import { subagentModelBinding } from "./subagent-model-binding.js";
import { buildProviderModel, type RuntimeProviderConfig } from "./provider-binding.js";
import { claudeCacheOptions } from "./claude-cache.js";

function cacheControls(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => key === "cache_control" ? [child] : cacheControls(child));
}

describe("Claude caching through real runtime requests", () => {
  it.each(["5m", "1h"] as const)("sends %s on parent and delegate requests", async (ttl) => {
    const requests: unknown[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: object) => res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
      event("message_start", { message: { id: "msg-cache", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
      event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Cache request accepted." } });
      event("content_block_stop", { index: 0 });
      event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } });
      event("message_stop", {});
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local provider address");
    const provider: RuntimeProviderConfig = {
      id: "cache-fixture", name: "Cache fixture", vendorKey: "custom", modelId: "claude-sonnet-4-6",
      baseUrl: "http://127.0.0.1:" + address.port, apiStyle: "anthropic_messages", apiKey: "", authKind: "none",
      supportsReasoning: false, supportedThinkingLevels: ["off"],
      modelConfig: modelConfigWithBinding(genericModelConfig("claude-sonnet-4-6"), {
        contextWindow: 200_000, maxTokens: 8192, thinkingLevels: ["off"], claudeCacheTtl: ttl,
      }),
    };
    const errors: unknown[] = [];
    const runtime = new DesktopAgentRuntime({
      sessionId: "cache-parent", mode: "agent", provider, thinkingLevel: "off", history: [],
      commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
      host: { call: async <T>(method: string): Promise<T> => {
        if (method !== "session.appendMessage") throw new Error("Unexpected host method: " + method);
        return undefined as T;
      } },
      onEvent: ({ event }) => { if (event.type === "error") errors.push(event.error); },
    });
    try {
      await runtime.prompt("Explain caching briefly.", "cache-user", "cache-turn");
      expect(errors).toEqual([]);
      const delegate = subagentModelBinding({ provider, sessionId: "cache-child", thinkingLevel: "off" }, { claim: () => undefined });
      const stream = await delegate.streamFn(delegate.model, normalizeContext({
        messages: [{ role: "system", content: "Answer briefly.", timestamp: Date.now() }, { role: "user", content: "Check cache.", timestamp: Date.now() }],
      }), { apiKey: "local-fixture" });
      expect((await stream.result()).stopReason).toBe("stop");
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        const markers = cacheControls(request);
        expect(markers.length).toBeGreaterThan(0);
        for (const marker of markers) expect(marker).toEqual(ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" });
        expect(request).not.toHaveProperty("prompt_cache_retention");
      }
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("preserves no-cache calls and leaves other wire protocols alone", () => {
    const config = { claudeCacheTtl: "1h" as const };
    expect(claudeCacheOptions({ api: "anthropic-messages", id: "claude-sonnet-4-6" }, config, { cacheRetention: "none" })).toEqual({ cacheRetention: "none" });
    expect(claudeCacheOptions({ api: "openai-responses", id: "gpt-5" }, config)).toEqual({});
    expect(claudeCacheOptions({ api: "openai-completions", id: "claude-sonnet-4-6" }, config)).toEqual({});
    expect(claudeCacheOptions({ api: "anthropic-messages", id: "glm-5" }, config)).toEqual({});
    expect(claudeCacheOptions({ api: "anthropic-messages", id: "claude-haiku-4-5" }, undefined)).toEqual({ cacheRetention: "short" });
  });

  it("honors an explicit hour instead of silently using a gateway's short default", () => {
    const model = buildProviderModel({
      id: "fixture", name: "Fixture", modelId: "claude-sonnet-4-6", apiKey: "", apiStyle: "anthropic_messages",
      baseUrl: "https://fixture.invalid", supportsReasoning: false, supportedThinkingLevels: ["off"],
      modelConfig: { ...genericModelConfig("claude-sonnet-4-6"), claudeCacheTtl: "1h", compat: { supportsLongCacheRetention: false } },
    });
    expect(model.compat).toMatchObject({ supportsLongCacheRetention: true });
  });
});
