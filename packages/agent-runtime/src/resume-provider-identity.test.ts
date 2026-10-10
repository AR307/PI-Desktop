import { expect, it } from "vitest";
import { convertMessages } from "@earendil-works/pi-ai/api/openai-completions";
import type { UiMessage } from "@pi-desktop/shared";
import {
  buildProviderModel,
  type RuntimeProviderConfig,
} from "./provider-binding.js";
import { seedDelegateMessages } from "./delegation-history.js";
import { contextBudgetLimitsFor } from "./context-budget.js";

/**
 * Task(resume) must tag restored assistant history with model.provider so
 * pi-ai's same-model check keeps DeepSeek (and similar) reasoning in
 * reasoning_content. Tagging with the account row id instead makes the
 * adapter treat the history as foreign-model and empties that field.
 */
function replay(vendorKey?: string) {
  const provider: RuntimeProviderConfig = {
    id: "account-row-uuid",
    vendorKey,
    name: "DeepSeek account",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-reasoner",
    apiKey: "unused-fixture",
    supportsReasoning: true,
    supportedThinkingLevels: ["off", "high"],
  };
  const model = buildProviderModel(provider);
  const originalThinking =
    "Inspect the authorization boundary before reading the file.";
  const rows: UiMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      content: "I will read permissions.ts.",
      thinking: originalThinking,
      createdAt: "2026-10-10T00:00:00.000Z",
    },
    {
      id: "result-1",
      role: "tool",
      content: "file contents",
      toolCallId: "call-1",
      toolName: "Read",
      toolArgs: { path: "permissions.ts" },
      createdAt: "2026-10-10T00:00:01.000Z",
    },
  ];
  const messages = seedDelegateMessages({
    originalTask: "Inspect permissions.",
    rows,
    provider,
    model,
    budget: contextBudgetLimitsFor(model),
  });
  const compat = {
    ...model.compat,
    supportsDeveloperRole: false,
    supportsOpenAIGrammarTools: false,
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
    deferredToolsMode: "none",
  };
  const wire = convertMessages(
    model as never,
    { messages } as never,
    compat as never,
  );
  return {
    messages,
    model,
    originalThinking,
    assistant: wire.find((message) => message.role === "assistant") as
      | { content?: unknown; reasoning_content?: string }
      | undefined,
  };
}

it("resuming on the same vendor account preserves its original reasoning field", () => {
  const { assistant, originalThinking, messages, model } = replay("deepseek");
  expect(assistant?.reasoning_content).toBe(originalThinking);
  expect(
    messages.find((message) => message.role === "assistant")?.provider,
  ).toBe(model.provider);
});

it("control: the old no-vendor-key binding preserves reasoning", () => {
  const { assistant, originalThinking } = replay();
  expect(assistant?.reasoning_content).toBe(originalThinking);
});
