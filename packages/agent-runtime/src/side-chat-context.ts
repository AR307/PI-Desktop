import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextCompactionRecord } from "@pi-desktop/shared";
import type { MessageEntry } from "./pi-runtime-types.js";

/** Ownership transfer between child runtimes, never a persisted parent snapshot. */
export type SideChatRuntimeState = {
  entries: MessageEntry[];
  compaction?: ContextCompactionRecord;
};

/** Completed tool pairs are evidence, never work scheduled by the child. */
export function sideChatContext(messages: readonly AgentMessage[]): AgentMessage[] {
  const completed = new Set(
    messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
  );
  return structuredClone(
    messages.flatMap((message): AgentMessage[] => {
      if (message.role !== "assistant") return [message];
      const content = message.content.filter(
        (part) => part.type !== "toolCall" || completed.has(part.id),
      );
      return content.length ? [{ ...message, content }] : [];
    }),
  );
}
