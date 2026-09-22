import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { genericModelConfig } from "./model-capabilities.js";
import { completeOneShot } from "./one-shot-complete.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

it("concurrent Gemini completions retain their own transport headers and thinking", async () => {
  const pending: ServerResponse[] = [];
  const seen: Array<{ path: string; session?: string; budget?: number }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const header = request.headers["x-local-session"];
    seen.push({ path: request.url ?? "", session: typeof header === "string" ? header : undefined, budget: body.generationConfig?.thinkingConfig?.thinkingBudget });
    if (request.url === "/unrelated") { response.end("ok"); return; }
    pending.push(response);
    // Both SDK requests must overlap before either finishes.
    if (pending.length !== 2) return;
    for (const output of pending) {
      output.writeHead(200, { "content-type": "text/event-stream" });
      output.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Completed" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } })}\n\n`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const complete = (id: string) => {
      const baseUrl = `${origin}/${id}/v1beta`;
      const provider: RuntimeProviderConfig = {
        id, name: id, modelId: "gemini-2.5-flash", apiKey: "local-fixture",
        baseUrl, apiStyle: "google_generative_ai", supportsReasoning: true,
        supportedThinkingLevels: ["off", "medium"], headers: { "x-local-session": id },
        modelConfig: { ...genericModelConfig("gemini-2.5-flash", baseUrl), reasoning: true, supportedThinkingLevels: ["off", "medium"] },
      };
      return completeOneShot(provider, { messages: [{ role: "user", content: "Local test", timestamp: 1 }], tools: [] }, "medium", { signal: AbortSignal.timeout(10_000) });
    };
    const results = await Promise.all([complete("first"), complete("second")]);
    expect(results.map((result) => result.text)).toEqual(["Completed", "Completed"]);
    for (const item of seen) {
      expect(item.path).toContain(`/${item.session}/v1beta/`);
      expect(item.budget).toBeGreaterThan(0);
    }
    await fetch(`${origin}/unrelated`);
    expect(seen.at(-1)?.session).toBeUndefined();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15_000);
