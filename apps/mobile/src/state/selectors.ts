import type { UiMessage } from "@pi-desktop/shared";

const latestTopLevel = new WeakMap<readonly UiMessage[], string | undefined>();

/**
 * The newest top-level (non-tool, non-delegate) message id. Every rendered
 * message asks for it on each store patch, so it is derived once per
 * transcript array instead of filtering the whole transcript per message.
 */
export function latestTopLevelMessageId(messages: readonly UiMessage[]): string | undefined {
  if (latestTopLevel.has(messages)) return latestTopLevel.get(messages);
  let id: string | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!message.parentToolCallId && message.role !== "tool") { id = message.id; break; }
  }
  latestTopLevel.set(messages, id);
  return id;
}
