import { TRANSCRIPT_DISPLAY_TRUNCATION_MARKER, type RacpItemSummary, type UiMessage } from "@pi-desktop/shared";

export const MOBILE_TRANSCRIPT_PAGE_BYTES = 512 * 1024;

/** Keep the durable message identity and a readable preview; session/item owns the complete content. */
export function fitMobileItem(item: RacpItemSummary): RacpItemSummary {
  if (Buffer.byteLength(JSON.stringify(item)) <= MOBILE_TRANSCRIPT_PAGE_BYTES / 2) return item;
  const message = item.content as UiMessage;
  const content = message.content.slice(0, 4 * 1024).replace(/\s+$/u, "") + TRANSCRIPT_DISPLAY_TRUNCATION_MARKER;
  return { ...item, content: {
    id: message.id, role: message.role, createdAt: message.createdAt, content,
    ...(message.status ? { status: message.status } : {}),
    ...(message.modelId ? { modelId: message.modelId } : {}),
    ...(message.providerId ? { providerId: message.providerId } : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolStatus ? { toolStatus: message.toolStatus } : {}),
    ...(message.parentToolCallId ? { parentToolCallId: message.parentToolCallId } : {}),
    ...(message.nestedParentToolCallId ? { nestedParentToolCallId: message.nestedParentToolCallId } : {}),
    ...(message.agentName ? { agentName: message.agentName } : {}),
    ...(message.toolArgs !== undefined ? { toolArgs: "[truncated for display]" } : {}),
    ...(message.toolResult !== undefined ? { toolResult: "[truncated for display]" } : {}),
  } satisfies UiMessage };
}

/** History/snapshot pages retain the newest contiguous tail for backward paging. */
export function fitMobileHistory(items: RacpItemSummary[]): { items: RacpItemSummary[]; omitted: boolean } {
  const selected: RacpItemSummary[] = [];
  let bytes = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = fitMobileItem(items[index]);
    const size = Buffer.byteLength(JSON.stringify(item));
    if (bytes + size > MOBILE_TRANSCRIPT_PAGE_BYTES) break;
    selected.unshift(item);
    bytes += size;
  }
  return { items: selected, omitted: selected.length < items.length };
}
