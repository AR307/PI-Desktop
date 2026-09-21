import { applyMessageUpdate, type AgentEvent, type MobileSessionSnapshot, type RacpEventEnvelope, type RacpItemSummary, type UiMessage } from "@pi-desktop/shared";

export function itemMessage(item: RacpItemSummary): UiMessage | null {
  if (!item.content || typeof item.content !== "object") return null;
  const row = item.content as Record<string, unknown>;
  if (typeof row.id === "string" && typeof row.role === "string" && typeof row.content === "string") return row as UiMessage;
  if (item.itemType === "tool") return {
    id: item.id, role: "tool", content: "", createdAt: item.createdAt,
    toolCallId: item.id, toolName: typeof row.toolName === "string" ? row.toolName : "Tool",
    toolArgs: row.args, toolResult: row.partialResult ?? row.result,
    toolStatus: item.status === "streaming" ? "running" : row.isError ? "error" : "success",
  };
  return null;
}

export function mergeMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function snapshotMessages(snapshot: MobileSessionSnapshot): UiMessage[] {
  return mergeMessages([], [...snapshot.items, ...snapshot.activeItems].flatMap((item) => { const message = itemMessage(item); return message ? [message] : []; }));
}

export function applyTranscriptEvent(messages: UiMessage[], envelope: RacpEventEnvelope): UiMessage[] {
  const payload = envelope.payload as { event?: AgentEvent } | undefined;
  const event = payload?.event;
  if (!event) return messages;
  switch (event.type) {
    case "message_start": return mergeMessages(messages, [event.message]);
    case "message_end": return mergeMessages(messages.filter((message) => message.id !== event.replacesMessageId), [...(event.precedingAssistant ? [event.precedingAssistant] : []), event.message]);
    case "user_message_persisted": return mergeMessages(messages.filter((message) => message.id !== event.optimisticMessageId), [event.message]);
    case "message_update": return mergeMessages(messages, [applyMessageUpdate(messages.find((message) => message.id === event.message.id), event)]);
    case "tool_start": return mergeMessages(messages, [{ id: event.toolCallId, role: "tool", content: "", createdAt: envelope.occurredAt, toolName: event.toolName, toolCallId: event.toolCallId, toolArgs: event.args, toolStatus: "running" }]);
    case "tool_update": return messages.map((message) => message.toolCallId === event.toolCallId ? { ...message, toolResult: event.partialResult } : message);
    case "tool_end": return messages.map((message) => message.toolCallId === event.toolCallId ? { ...message, toolResult: event.result, toolStatus: event.isError ? "error" : "success" } : message);
    default: return messages;
  }
}
