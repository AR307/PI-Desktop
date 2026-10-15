import { afterEach, expect, it, vi } from "vitest";
import { completeOneShot } from "./one-shot-complete.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

const provider: RuntimeProviderConfig = {
  id: "fixture",
  name: "Fixture",
  modelId: "fixture",
  apiStyle: "chat_completions",
  baseUrl: "http://fixture.invalid/v1",
  apiKey: "test-only",
  supportsReasoning: false,
  supportedThinkingLevels: ["off"],
};
afterEach(() => vi.unstubAllGlobals());

for (const [mode, code, expectedRequests] of [
  ["empty", "EMPTY_COMPLETION", 2],
  ["thinking", "MODEL_THINKING_ONLY", 1],
  ["length", "MODEL_OUTPUT_TRUNCATED", 1],
] as const) {
  it("one-shot " + mode + " obeys the same non-replay boundary", async () => {
    const fetch = vi.fn(async () => {
      const chunk = (delta: unknown, reason: string | null) =>
        "data: " +
        JSON.stringify({
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [{ index: 0, delta, finish_reason: reason }],
        }) +
        "\n\n";
      const delta =
        mode === "thinking"
          ? { reasoning_content: "Retained thought" }
          : { content: mode === "empty" ? "" : "Partial text" };
      return new Response(
        chunk(delta, null) + chunk({}, mode === "length" ? "length" : "stop") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      completeOneShot(
        provider,
        { messages: [{ role: "user", content: "Summarize.", timestamp: 0 }] },
        "off",
      ),
    ).rejects.toMatchObject({
      errorCode: code,
      data: { response: { attempts: expectedRequests } },
    });
    expect(fetch).toHaveBeenCalledTimes(expectedRequests);
  });
}
