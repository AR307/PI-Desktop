import { afterEach, expect, it, vi } from "vitest";
import type { AgentEventEnvelope, UiMessage } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "./runtime.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";
import { requestDiagnostics } from "./request-diagnostics.js";
import { SubagentRun } from "./subagent.js";
import { completeOneShot } from "./one-shot-complete.js";

const provider: RuntimeProviderConfig = {
  id: "native-fixture",
  name: "Native fixture",
  modelId: "vendor/CLAUDE-fixture-thinking",
  apiKey: "test-only",
  baseUrl: "http://fixture.invalid",
  apiStyle: "anthropic_messages",
  mirrorCodingGroupId: "中文 分组",
  supportsReasoning: true,
  supportedThinkingLevels: ["max"],
  modelConfig: {
    source: "generic",
    name: "Native fixture",
    baseUrl: "http://fixture.invalid",
    reasoning: true,
    reasoningOptions: [{ type: "effort", values: ["max"] }],
    thinkingLevelMap: { max: "max" },
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};
type Step = "thinking" | "unsigned" | "length" | "interrupted" | "tool" | "broken-tool" | "answer";
function nativeFixture(steps: Step[]) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let executions = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      const step = steps[requests.length - 1];
      if (!step) throw new Error("Unexpected replay");
      const emit = (type: string, fields: Record<string, unknown> = {}) =>
        "event: " + type + "\ndata: " + JSON.stringify({ type, ...fields }) + "\n\n";
      let body = emit("message_start", {
        message: {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: provider.modelId,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 7, output_tokens: 0 },
        },
      });
      if (step === "thinking" || step === "unsigned") {
        body += emit("content_block_start", {
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        });
        body += emit("content_block_delta", {
          index: 0,
          delta: { type: "thinking_delta", thinking: "Retained native thought" },
        });
        if (step === "thinking")
          body += emit("content_block_delta", {
            index: 0,
            delta: { type: "signature_delta", signature: "fixture-native-signature" },
          });
      } else if (step === "tool" || step === "broken-tool") {
        body += emit("content_block_start", {
          index: 0,
          content_block: { type: "tool_use", id: "call_fixture", name: "Read", input: {} },
        });
        body += emit("content_block_delta", {
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: step === "tool" ? '{"path":"fixture.txt"}' : '{"path":',
          },
        });
      } else {
        body += emit("content_block_start", {
          index: 0,
          content_block: { type: "text", text: "" },
        });
        body += emit("content_block_delta", {
          index: 0,
          delta: {
            type: "text_delta",
            text: step === "answer" ? "Explicit continuation completed" : "Partial native answer",
          },
        });
      }
      if (step !== "interrupted") {
        body += emit("content_block_stop", { index: 0 });
        body += emit("message_delta", {
          delta: {
            stop_reason: ["length", "broken-tool"].includes(step)
              ? "max_tokens"
              : step === "tool"
                ? "tool_use"
                : "end_turn",
            stop_sequence: null,
          },
          usage: { output_tokens: 9 },
        });
        body += emit("message_stop");
      }
      return new Response(body, {
        headers: { "content-type": "text/event-stream", "request-id": "native-request-id" },
      });
    }),
  );
  function runtime(history: UiMessage[] = []) {
    const events: AgentEventEnvelope[] = [];
    const agent = new DesktopAgentRuntime({
      sessionId: "native-session",
      mode: "agent",
      provider,
      history,
      thinkingLevel: "max",
      infiniteProviderRetry: true,
      commandShell: {
        id: "bash",
        label: "Bash",
        dialect: "posix",
        available: true,
        isDefault: true,
      },
      host: {
        async call<T>(method: string): Promise<T> {
          if (method !== "tools.execute") throw new Error("Unexpected host call: " + method);
          executions++;
          return { ok: true, content: "Completed tool result" } as T;
        },
      },
      onEvent: (event) => events.push(event),
    });
    const messages = () =>
      events.flatMap((e) => (e.event.type === "message_end" ? [e.event.message] : []));
    return { agent, events, messages };
  }
  return { requests, runtime, executions: () => executions };
}
afterEach(() => vi.unstubAllGlobals());

for (const [step, code, end] of [
  ["thinking", "MODEL_THINKING_ONLY", "thinking-only"],
  ["length", "MODEL_OUTPUT_TRUNCATED", "truncated"],
  ["interrupted", "STREAM_FAILED", "interrupted"],
  ["broken-tool", "MODEL_OUTPUT_TRUNCATED", "truncated"],
] as const) {
  it(
    "native " + step + " retains content without infinite replay or unfinished tool execution",
    async () => {
      const f = nativeFixture([step]);
      const r = f.runtime();
      try {
        await r.agent.prompt("Use the configured max reasoning.");
        expect(f.requests).toHaveLength(1);
        expect(f.executions()).toBe(0);
        expect(f.requests[0].url).toContain("/v1/messages");
        expect(f.requests[0].body).toMatchObject({
          model: provider.modelId,
          thinking: { type: "adaptive" },
          output_config: { effort: "max" },
        });
        expect(f.requests[0].body.thinking).not.toHaveProperty("budget_tokens");
        expect(r.messages().at(-1)).toMatchObject({
          status: "error",
          error: { code },
          responseDiagnostics: {
            end,
            api: "anthropic-messages",
            path: "/v1/messages",
            reasoning: { "output_config.effort": "max" },
            group: "中文 分组",
            attempts: 1,
          },
        });
      } finally {
        await r.agent.dispose();
      }
    },
  );
}

it("restarts and continues with signed thought and completed tool results, without rerunning the tool", async () => {
  const f = nativeFixture(["tool", "thinking", "answer"]);
  const first = f.runtime();
  const history: UiMessage[] = [];
  try {
    await first.agent.prompt("Read then answer.");
    history.push(
      {
        id: "user-first",
        role: "user",
        content: "Read then answer.",
        status: "complete",
        createdAt: new Date().toISOString(),
      },
      ...first.messages(),
    );
    // Host persists completed tool rows separately from assistant events.
    const toolEnd = first.events.find((e) => e.event.type === "tool_end");
    expect(toolEnd).toBeTruthy();
    history.splice(2, 0, {
      id: "tool-row",
      role: "tool",
      content: "Completed tool result",
      toolResult: { content: "Completed tool result" },
      toolName: "Read",
      toolCallId: "call_fixture",
      toolArgs: { path: "fixture.txt" },
      toolStatus: "success",
      status: "complete",
      createdAt: new Date().toISOString(),
    });
    expect(f.requests).toHaveLength(2);
  } finally {
    await first.agent.dispose();
  }
  const resumed = f.runtime(history);
  try {
    await resumed.agent.prompt("Continue with the answer.");
    expect(f.requests).toHaveLength(3);
    expect(f.executions()).toBe(1);
    const body = JSON.stringify(f.requests[2].body.messages);
    expect(body).toContain("fixture-native-signature");
    expect(body).toContain("Completed tool result");
    expect(body).toContain("Continue with the answer.");
    expect(resumed.messages().at(-1)?.content).toBe("Explicit continuation completed");
  } finally {
    await resumed.agent.dispose();
  }
});

it("keeps unsigned thinking for display but never manufactures a replay signature", async () => {
  const f = nativeFixture(["unsigned", "answer"]);
  const first = f.runtime();
  await first.agent.prompt("Think.");
  const history = first.messages();
  await first.agent.dispose();
  expect(history.at(-1)?.thinking).toBe("Retained native thought");
  const resumed = f.runtime(history);
  try {
    await resumed.agent.prompt("Continue.");
    expect(JSON.stringify(f.requests[1].body.messages)).not.toContain("Retained native thought");
  } finally {
    await resumed.agent.dispose();
  }
});

it("extracts only final-wire diagnostic scalars, never prompts or authorization", () => {
  const result = requestDiagnostics("http://localhost/v1/messages?key=secret", {
    headers: { authorization: "Bearer secret" },
    body: JSON.stringify({
      model: "claude-fixture",
      messages: [{ content: "private prompt" }],
      api_key: "secret",
      max_tokens: 8192,
      thinking: { type: "adaptive", hidden: "secret" },
      output_config: { effort: "max" },
    }),
  });
  expect(result).toEqual({
    path: "/v1/messages",
    model: "claude-fixture",
    outputLimit: 8192,
    reasoning: { "thinking.type": "adaptive", "output_config.effort": "max" },
  });
});

it("captures declared Gemini wire parameters without retaining contents or auth queries", () => {
  expect(
    requestDiagnostics(
      "http://fixture.invalid/v1beta/models/gemini:streamGenerateContent?key=secret",
      {
        body: JSON.stringify({
          contents: [{ text: "private" }],
          generationConfig: {
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: true, private: "secret" },
          },
        }),
      },
    ),
  ).toEqual({
    path: "/v1beta/models/gemini:streamGenerateContent",
    outputLimit: 2048,
    reasoning: {
      "generationConfig.thinkingConfig.thinkingLevel": "HIGH",
      "generationConfig.thinkingConfig.includeThoughts": true,
    },
  });
});

for (const owner of ["subagent", "one-shot"] as const) {
  it(owner + " uses native max and reports thinking-only without replay", async () => {
    const f = nativeFixture(["thinking"]);
    if (owner === "subagent") {
      const events: AgentEventEnvelope[] = [];
      const run = new SubagentRun({
        definition: {
          name: "native",
          description: "Native fixture",
          prompt: "Report",
          source: "builtin",
          tools: [],
        },
        sessionId: "native-session",
        parentToolCallId: "task-native",
        task: "Report",
        provider,
        thinkingLevel: "max",
        systemPrompt: "Report",
        tools: [],
        onEvent: (event) => events.push(event),
      });
      expect(await run.run()).toMatchObject({
        status: "failed",
        error: { code: "MODEL_THINKING_ONLY" },
      });
      expect(
        events.flatMap((e) => (e.event.type === "message_end" ? [e.event.message] : [])).at(-1),
      ).toMatchObject({
        thinking: "Retained native thought",
        responseDiagnostics: { requestId: "native-request-id", attempts: 1, group: "中文 分组" },
      });
    } else {
      await expect(
        completeOneShot(
          provider,
          { messages: [{ role: "user", content: "Report", timestamp: 0 }] },
          "max",
        ),
      ).rejects.toMatchObject({
        errorCode: "MODEL_THINKING_ONLY",
        data: { response: { requestId: "native-request-id", attempts: 1, group: "中文 分组" } },
      });
    }
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].url).toContain("/v1/messages");
    expect(f.requests[0].body).toMatchObject({
      model: provider.modelId,
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
  });
}
