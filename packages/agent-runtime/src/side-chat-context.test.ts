import { describe, expect, it, vi } from "vitest";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { UiMessage } from "@pi-desktop/shared";
import { DesktopAgentRuntime, type AgentRuntimeOptions } from "./runtime.js";
import { sideChatContext } from "./side-chat-context.js";

const provider = {
  id: "fixture",
  name: "Fixture",
  modelId: "fixture",
  apiKey: "",
  authKind: "none" as const,
  baseUrl: "http://127.0.0.1:1/v1",
  supportsReasoning: false,
  supportedThinkingLevels: ["off" as const],
};
const commandShell = {
  id: "bash" as const,
  label: "Bash",
  dialect: "posix" as const,
  available: true,
  isDefault: true,
};
const assistant: AssistantMessage = {
  role: "assistant",
  api: "openai-completions",
  provider: "fixture",
  model: "fixture",
  timestamp: 2,
  stopReason: "toolUse",
  content: [
    { type: "text", text: "Completed explanation" },
    { type: "toolCall", id: "complete", name: "Read", arguments: { path: "old.txt" } },
    {
      type: "toolCall",
      id: "pending",
      name: "Write",
      arguments: { path: "pending.txt", content: "never replay" },
    },
  ],
  usage: {
    input: 1,
    output: 1,
    totalTokens: 2,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

function fixture(options: Partial<AgentRuntimeOptions> = {}) {
  const writes: Array<{ method: string; params: unknown }> = [];
  const wire: Array<{
    messages: Array<{ role: string; content?: unknown; tool_calls?: unknown[] }>;
  }> = [];
  const runtime = new DesktopAgentRuntime({
    sessionId: "side-fixture",
    mode: "agent",
    provider,
    thinkingLevel: "off",
    commandShell,
    host: {
      call: async <T>(method: string, params?: unknown): Promise<T> => {
        writes.push({ method, params });
        if (method !== "session.appendMessage")
          throw new Error("Unexpected host effect: " + method);
        return undefined as T;
      },
    },
    onEvent: () => {},
    ...options,
  });
  const agent = (runtime as unknown as { agent: Agent }).agent;
  agent.streamFunction = (model, context) =>
    stream(model as Model<"openai-completions">, context, {
      apiKey: "fixture",
      fetch: async (_url, init) => {
        wire.push(JSON.parse(String(init?.body)));
        return new Response(
          'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Child answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
  return { runtime, writes, wire };
}

describe("temporary side chat effective context", () => {
  it("can edit an earlier child turn after changing execution mode", async () => {
    const child = fixture({
      initialContext: [{ role: "user", content: "INHERITED_PARENT", timestamp: 1 }],
    });
    await child.runtime.prompt("FIRST_CHILD", "first", "first-turn");
    await child.runtime.prompt("DISCARDED_CHILD", "discarded", "discarded-turn");
    await child.runtime.dispose();
    const changed = fixture({ mode: "plan", sideChatState: child.runtime.takeSideChatState() });
    try {
      changed.runtime.rewindSideChat("discarded");
      await changed.runtime.prompt("EDITED_CHILD", "edited", "edited-turn");
      const request = JSON.stringify(changed.wire.at(-1));
      expect(request).toContain("INHERITED_PARENT");
      expect(request).toContain("FIRST_CHILD");
      expect(request).toContain("EDITED_CHILD");
      expect(request).not.toContain("DISCARDED_CHILD");
    } finally {
      await changed.runtime.dispose();
    }
  });

  it("compacts a long inherited conversation without persisting parent material", async () => {
    const summaries: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      summaries.push(JSON.parse(String(init?.body)));
      return new Response(
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"SIDE_MEMORY_SUMMARY"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const child = fixture({
      initialContext: [
        { role: "user", content: "LONG_PARENT_ONLY ".repeat(6000), timestamp: 1 },
        { ...assistant, content: [{ type: "text", text: "Parent completed" }], stopReason: "stop" },
        { role: "user", content: "Recent parent question", timestamp: 3 },
      ],
    });
    try {
      await child.runtime.prompt("BEFORE_COMPACTION", "before", "turn-before");
      await child.runtime.compactManually();
      expect(summaries.length).toBeGreaterThan(0);
      expect(JSON.stringify(summaries)).toContain("LONG_PARENT_ONLY");
      await child.runtime.prompt("AFTER_COMPACTION", "after", "turn-after");
      expect(JSON.stringify(child.wire.at(-1))).toContain("SIDE_MEMORY_SUMMARY");
      expect(JSON.stringify(child.writes)).not.toContain("SIDE_MEMORY_SUMMARY");
      expect(JSON.stringify(child.writes)).not.toContain("LONG_PARENT_ONLY");
      expect(child.writes.every((write) => write.method === "session.appendMessage")).toBe(true);
      await child.runtime.dispose();
      const changed = fixture({ mode: "plan", sideChatState: child.runtime.takeSideChatState() });
      try {
        await changed.runtime.prompt("AFTER_MODE_CHANGE", "changed", "turn-changed");
        expect(JSON.stringify(changed.wire.at(-1))).toContain("SIDE_MEMORY_SUMMARY");
        expect(JSON.stringify(changed.writes)).not.toContain("SIDE_MEMORY_SUMMARY");
        changed.runtime.rewindSideChat("after");
        await changed.runtime.prompt("EDIT_WITH_SUMMARY", "edited", "turn-edited");
        expect(JSON.stringify(changed.wire.at(-1))).toContain("SIDE_MEMORY_SUMMARY");
        expect(JSON.stringify(changed.wire.at(-1))).not.toContain("AFTER_COMPACTION");
      } finally {
        await changed.runtime.dispose();
      }
    } finally {
      await child.runtime.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("retains parent and child context when the child model changes", async () => {
    const child = fixture({
      initialContext: [{ role: "user", content: "PARENT_CONTEXT", timestamp: 1 }],
    });
    try {
      await child.runtime.prompt("FIRST_CHILD", "first", "turn-1");
      child.runtime.rebindTurn({
        mode: "agent",
        thinkingLevel: "off",
        commandShell,
        provider: { ...provider, modelId: "fixture-2" },
      });
      await child.runtime.prompt("NEW_MODEL_QUESTION", "second", "turn-2");
      const wire = JSON.stringify(child.wire.at(-1));
      expect(wire).toContain("PARENT_CONTEXT");
      expect(wire).toContain("FIRST_CHILD");
      expect(wire).toContain("fixture-2");
    } finally {
      await child.runtime.dispose();
    }
  });

  it("includes inherited images in the actual provider request", async () => {
    const child = fixture({
      initialContext: [
        {
          role: "user",
          timestamp: 1,
          content: [
            { type: "text", text: "PARENT_IMAGE" },
            { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
          ],
        },
      ],
      provider: {
        ...provider,
        modelConfig: {
          source: "generic",
          name: "Vision fixture",
          baseUrl: provider.baseUrl,
          reasoning: false,
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 4096,
        },
      },
    });
    try {
      await child.runtime.prompt("Explain inherited image", "child", "turn");
      expect(JSON.stringify(child.wire[0])).toContain("data:image/png;base64,aW1hZ2U=");
    } finally {
      await child.runtime.dispose();
    }
  });

  it("restores an unanswered child prompt without losing inherited context or previous child turns", async () => {
    const child = fixture({
      initialContext: [{ role: "user", content: "INHERITED_PARENT", timestamp: 1 }],
    });
    try {
      await child.runtime.prompt("FIRST_CHILD", "first", "first-turn");
      await child.runtime.prompt("DISCARDED_CHILD", "discarded", "discarded-turn");
      child.runtime.rewindSideChat("discarded");
      await child.runtime.prompt("RESEND_CHILD", "resend", "resend-turn");
      const request = JSON.stringify(child.wire.at(-1));
      expect(request).toContain("INHERITED_PARENT");
      expect(request).toContain("FIRST_CHILD");
      expect(request).toContain("RESEND_CHILD");
      expect(request).not.toContain("DISCARDED_CHILD");
    } finally {
      await child.runtime.dispose();
    }
  });

  it("sends completed historical tool results without executing the historical tool", async () => {
    const child = fixture({
      initialContext: sideChatContext([
        { role: "user", content: "PARENT_TOOL_QUESTION", timestamp: 1 },
        assistant,
        {
          role: "toolResult",
          toolCallId: "complete",
          toolName: "Read",
          timestamp: 3,
          isError: false,
          content: [{ type: "text", text: "HISTORICAL_TOOL_EVIDENCE" }],
        },
      ]),
    });
    try {
      await child.runtime.prompt("Explain the evidence", "child-user", "child-turn");
      expect(JSON.stringify(child.wire[0])).toContain("HISTORICAL_TOOL_EVIDENCE");
      expect(JSON.stringify(child.wire[0])).not.toContain("pending.txt");
      expect(child.writes.every((write) => write.method === "session.appendMessage")).toBe(true);
    } finally {
      await child.runtime.dispose();
    }
  });

  it("keeps completed evidence and attachments but strips unfinished tool calls without mutating the parent", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        timestamp: 1,
        content: [
          { type: "text", text: "Look at this image" },
          { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
        ],
      },
      assistant,
      {
        role: "toolResult",
        toolCallId: "complete",
        toolName: "Read",
        timestamp: 3,
        isError: false,
        content: [{ type: "text", text: "Historical file content" }],
      },
    ];
    const context = sideChatContext(messages);
    expect(JSON.stringify(context)).not.toContain("pending.txt");
    expect(JSON.stringify(context)).toContain("Historical file content");
    expect(context[0]).toEqual(messages[0]);
    expect(context[0]).not.toBe(messages[0]);
    expect(assistant.content).toHaveLength(3);
  });

  it("sends the current compacted context and latest reply without copying parent rows or replaying tools", async () => {
    const stamp = "2026-10-18T00:00:00Z";
    const history: UiMessage[] = [
      {
        id: "old",
        role: "user",
        content: "OLD_PARENT_HISTORY",
        createdAt: stamp,
        status: "complete",
      },
      {
        id: "recent",
        role: "user",
        content: "RECENT_PARENT_QUESTION",
        createdAt: stamp,
        status: "complete",
      },
      {
        id: "latest",
        role: "assistant",
        content: "LATEST_COMPLETE_REPLY",
        createdAt: stamp,
        status: "complete",
      },
    ];
    const parent = fixture({
      sessionId: "parent",
      history,
      compaction: {
        id: "checkpoint",
        summary: "COMPACTED_PARENT_SUMMARY",
        firstKeptMessageId: "recent",
        throughMessageId: "recent",
        tokensBefore: 200000,
        retainedTail: [{ role: "user", content: "RECENT_PARENT_QUESTION", timestamp: 2 }],
        createdAt: stamp,
      },
    });
    const context = parent.runtime.sideChatContext();
    const child = fixture({ initialContext: context });
    try {
      await child.runtime.prompt("SIDE_QUESTION", "child-user", "child-turn");
      expect(child.wire).toHaveLength(1);
      const request = JSON.stringify(child.wire[0]);
      expect(request).toContain("COMPACTED_PARENT_SUMMARY");
      expect(request).toContain("RECENT_PARENT_QUESTION");
      expect(request).toContain("LATEST_COMPLETE_REPLY");
      expect(request).not.toContain("OLD_PARENT_HISTORY");
      expect(JSON.stringify(child.writes)).not.toContain("COMPACTED_PARENT_SUMMARY");
      expect(JSON.stringify(child.writes)).not.toContain("LATEST_COMPLETE_REPLY");
      expect(JSON.stringify(parent.runtime.sideChatContext())).not.toContain("SIDE_QUESTION");
    } finally {
      await child.runtime.dispose();
      await parent.runtime.dispose();
    }
  });
});
