import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, SystemMessage } from "@earendil-works/pi-ai";
import { removeTrailingEmptyAssistantMessages } from "./response-outcome.js";

const empty: AssistantMessage = {
  role: "assistant", content: [], api: "openai-completions", provider: "local",
  model: "local-model", stopReason: "error", errorMessage: "timeout", timestamp: 2,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
const user: AgentMessage = { role: "user", content: "Continue the task", timestamp: 1 };
const delta: SystemMessage = { role: "system", content: "", timestamp: 3,
  sections: { runtime: "Updated instructions" } };

describe("retry transcript cleanup", () => {
  it("removes empty failures across system deltas without mutating the transcript", () => {
    const messages = [user, empty, delta, empty];
    expect(removeTrailingEmptyAssistantMessages(messages)).toEqual([user, delta]);
    expect(messages).toHaveLength(4);
  });

  it.each<AssistantMessage["content"]>([
    [{ type: "text", text: "The first step is complete." }],
    [{ type: "thinking", thinking: "Continue from here", thinkingSignature: "signature" }],
    [{ type: "toolCall", id: "read-1", name: "Read", arguments: { path: "notes.txt" } }],
  ])("retains meaningful partial output before a failed response", (...content) => {
    const partial: AssistantMessage = { ...empty, content };
    expect(removeTrailingEmptyAssistantMessages([user, partial, delta, empty]))
      .toEqual([user, partial, delta]);
  });

  it("retains completed tool results and an already compacted tail", () => {
    const result: AgentMessage = { role: "toolResult", toolCallId: "read-1", toolName: "Read",
      content: [{ type: "text", text: "Already read" }], isError: false, timestamp: 2 };
    expect(removeTrailingEmptyAssistantMessages([user, result, empty, delta]))
      .toEqual([user, result, delta]);
    expect(removeTrailingEmptyAssistantMessages([user, delta])).toEqual([user, delta]);
  });
});
