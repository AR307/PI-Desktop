import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "./runtime.js";
import { modelConfigFromPi } from "./model-capabilities.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

type RequestBody = {
  model: string;
  input: Array<{ type?: string; role?: string; content?: unknown; reasoning?: { effort?: string } }>;
  tools?: Array<{ name?: string }>;
  reasoning?: { effort: string };
};

function reply(response: ServerResponse, taskCall?: { id: string; agent: string; task: string }) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const send = (data: { type: string; [key: string]: unknown }) =>
    response.write("event: " + data.type + "\ndata: " + JSON.stringify(data) + "\n\n");
  send({ type: "response.created", response: { id: "resp_fixture" } });
  const item = taskCall
    ? { id: "fc_fixture", type: "function_call", call_id: taskCall.id, name: "Task",
        arguments: JSON.stringify({ agent: taskCall.agent, task: taskCall.task }), status: "completed" }
    : { id: "msg_fixture", type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "Parent completed.", annotations: [] }] };
  send({
    type: "response.output_item.added",
    output_index: 0,
    item: taskCall ? { ...item, arguments: "", status: "in_progress" } : { ...item, content: [], status: "in_progress" },
  });
  send(taskCall
    ? { type: "response.function_call_arguments.delta", output_index: 0, delta: JSON.stringify({ agent: taskCall.agent, task: taskCall.task }) }
    : { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Parent completed." });
  send({ type: "response.output_item.done", output_index: 0, item });
  send({ type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [item],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
  response.end();
}

describe("Ultra through the real parent and worker request path", () => {
  it.each([false, true])("sends xhigh and runs Task with catalog Ultra alias=%s", async (alias) => {
    const requests: RequestBody[] = [];
    const events: AgentEventEnvelope[] = [];
    let resolveChildReceived!: () => void;
    const childReceived = new Promise<void>(resolve => { resolveChildReceived = resolve; });
    let resolveWorkerEnded!: () => void;
    const workerEnded = new Promise<void>(resolve => { resolveWorkerEnded = resolve; });
    let childResponse: ServerResponse | undefined;
    let dispatch = true;
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body) as RequestBody;
      requests.push(parsed);
      const parent = parsed.tools?.some(tool => tool.name === "Task") === true;
      if (parent && dispatch) {
        dispatch = false;
        reply(response, { id: "inspect-worker", agent: "explorer",
          task: "Inspect the assigned module and report findings." });
      } else if (!parent) {
        childResponse = response;
        resolveChildReceived();
      } else reply(response);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    const builtin = getBuiltinModel("openai", "gpt-6.1-sol");
    if (!builtin) throw new Error("Missing installed GPT-6.1 Sol catalog entry");
    const config = modelConfigFromPi(builtin);
    if (alias) config.thinkingLevelMap = { ...config.thinkingLevelMap, xhigh: "ultra", max: "ultra" };
    const provider: RuntimeProviderConfig = {
      id: "ultra-wire-fixture", name: "Local Ultra acceptance",
      modelId: builtin.id, apiKey: "local-fixture-only",
      baseUrl: "http://127.0.0.1:" + address.port + "/v1",
      apiStyle: "chat_completions", authKind: "api_key",
      supportsReasoning: true,
      supportedThinkingLevels: ["low", "medium", "high", "xhigh", "max"],
      modelConfig: config,
    };
    const runtime = new DesktopAgentRuntime({
      sessionId: "ultra-wire-session", mode: "agent", provider,
      thinkingLevel: "low", ultra: true,
      subagents: [{ name: "explorer", description: "Inspect an independent module.",
        prompt: "Inspect and report.", source: "builtin", tools: ["Read"] }],
      commandShell: { id: "bash", label: "Bash", dialect: "posix",
        available: true, isDefault: true },
      host: { async call<T>(method: string): Promise<T> {
        if (method === "session.appendMessage" || method === "session.queuePush") return undefined as T;
        throw new Error("Unexpected acceptance host request: " + method);
      } },
      onEvent(event) {
        events.push(event);
        if (event.event.type === "message_end" && event.event.message.parentToolCallId?.startsWith("inspect-worker"))
          resolveWorkerEnded();
      },
    });
    try {
      const firstPrompt = runtime.prompt("Inspect two independent modules with Ultra.", "first-user", "first-turn");
      await childReceived;
      expect(requests.slice(0, 2)).toHaveLength(2);
      expect(JSON.stringify(requests[0].input)).toContain("Proactively split");
      expect(requests[0].tools?.some(tool => tool.name === "Task")).toBe(true);
      for (const body of requests.slice(0, 2)) {
        expect(body.model).toBe("gpt-6.1-sol");
        expect(body.input.some(item =>
          item.type === "configuration_update" && item.reasoning?.effort === "xhigh",
        )).toBe(true);
      }
      expect(runtime.getStatus().backgroundDelegations).toBe(1);
      if (!childResponse) throw new Error("Worker did not reach the local HTTP server");
      reply(childResponse);
      await firstPrompt;
      await workerEnded;
      runtime.setTurnReasoning("low", false);
      await runtime.prompt("Continue in ordinary low reasoning.", "second-user", "second-turn");
      expect(requests.at(-1)?.input.some(item =>
        item.type === "configuration_update" && item.reasoning?.effort === "low",
      )).toBe(true);
      runtime.setTurnReasoning("low", true);
      await runtime.prompt("Enable Ultra again.", "third-user", "third-turn");
      expect(requests.at(-1)?.input.some(item =>
        item.type === "configuration_update" && item.reasoning?.effort === "xhigh",
      )).toBe(true);
      expect(events.some(({ event }) => event.type === "error")).toBe(false);
      if (alias) expect(config.thinkingLevelMap).toMatchObject({ xhigh: "ultra", max: "ultra" });
    } finally {
      await runtime.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
