import { TRANSCRIPT_DISPLAY_TRUNCATION_MARKER, type MobileCompactionMark, type UiMessage } from "@pi-desktop/shared";

/**
 * Pure projection of the flat message list into what the conversation renders:
 * top-level rows, collapsible subagent groups (messages sharing a
 * `parentToolCallId`), and compaction dividers. Kept out of the components so
 * the grouping and truncation rules stay unit-testable.
 */
export type TranscriptEntry =
  | { kind: "message"; message: UiMessage }
  | { kind: "delegation"; id: string; agentName?: string; running: boolean; messages: UiMessage[] }
  | { kind: "compaction"; id: string };

export function buildTranscriptEntries(
  messages: readonly UiMessage[],
  compactions: readonly MobileCompactionMark[] = [],
): TranscriptEntry[] {
  const marks = new Map<string, MobileCompactionMark[]>();
  for (const mark of compactions) {
    const list = marks.get(mark.throughMessageId) ?? [];
    list.push(mark);
    marks.set(mark.throughMessageId, list);
  }
  const entries: TranscriptEntry[] = [];
  const groups = new Map<string, Extract<TranscriptEntry, { kind: "delegation" }>>();
  for (const message of messages) {
    const parent = message.parentToolCallId;
    if (parent) {
      let group = groups.get(parent);
      if (!group) {
        group = { kind: "delegation", id: parent, running: false, messages: [] };
        groups.set(parent, group);
        entries.push(group);
      }
      group.messages.push(message);
      group.agentName ??= message.agentName;
      if (message.status === "streaming" || message.toolStatus === "running") group.running = true;
    } else {
      entries.push({ kind: "message", message });
    }
    for (const mark of marks.get(message.id) ?? []) {
      entries.push({ kind: "compaction", id: mark.id });
    }
  }
  return entries;
}

/** True when host-core capped this text for display (`content_limit`). */
export function isDisplayTruncated(text: string | undefined): boolean {
  return typeof text === "string" && text.endsWith(TRANSCRIPT_DISPLAY_TRUNCATION_MARKER);
}

/** Whether any capped field on the message can be completed via `session/item`. */
export function messageHasTruncatedContent(message: UiMessage): boolean {
  if (isDisplayTruncated(message.content) || isDisplayTruncated(message.thinking)) return true;
  const scan = (value: unknown, depth: number): boolean => {
    if (depth > 4 || value == null) return false;
    if (typeof value === "string") return isDisplayTruncated(value) || value === "[truncated for display]";
    if (Array.isArray(value)) return value.some((item) => scan(item, depth + 1));
    if (typeof value === "object") return Object.values(value).some((item) => scan(item, depth + 1));
    return false;
  };
  return scan(message.toolArgs, 0) || scan(message.toolResult, 0);
}

export type DiffLine = { kind: "context" | "removed" | "added"; text: string };

/** Old/new strings from an Edit/Write-style tool call, when present. */
export function extractToolDiff(toolName: string | undefined, args: unknown): { before: string; after: string; path?: string } | null {
  if (!args || typeof args !== "object") return null;
  const row = args as Record<string, unknown>;
  const path = typeof row.path === "string" ? row.path : typeof row.file_path === "string" ? row.file_path : undefined;
  const before = typeof row.old_string === "string" ? row.old_string : typeof row.oldString === "string" ? row.oldString : undefined;
  const after = typeof row.new_string === "string" ? row.new_string : typeof row.newString === "string" ? row.newString : undefined;
  if (before !== undefined && after !== undefined) return { before, after, ...(path ? { path } : {}) };
  if (toolName === "Write" && typeof row.content === "string") return { before: "", after: row.content, ...(path ? { path } : {}) };
  return null;
}

const DIFF_CONTEXT_LINES = 2;
const DIFF_MAX_LINES = 160;

/**
 * Bounded line diff for the phone: common prefix/suffix collapse to context,
 * the changed middle renders as removed-then-added. Not a minimal edit script,
 * but honest and cheap for the tool-card sizes the transcript shows.
 */
export function buildDiffLines(before: string, after: string): DiffLine[] {
  const left = before.length ? before.split("\n") : [];
  const right = after.length ? after.split("\n") : [];
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) { endLeft -= 1; endRight -= 1; }
  const lines: DiffLine[] = [];
  for (let index = Math.max(0, start - DIFF_CONTEXT_LINES); index < start; index += 1) {
    lines.push({ kind: "context", text: left[index]! });
  }
  for (let index = start; index < endLeft; index += 1) lines.push({ kind: "removed", text: left[index]! });
  for (let index = start; index < endRight; index += 1) lines.push({ kind: "added", text: right[index]! });
  for (let index = endLeft; index < Math.min(left.length, endLeft + DIFF_CONTEXT_LINES); index += 1) {
    lines.push({ kind: "context", text: left[index]! });
  }
  return lines.length > DIFF_MAX_LINES ? lines.slice(0, DIFF_MAX_LINES) : lines;
}

export const TOOL_PREVIEW_CHARS = 2_000;

/** Stringify a tool payload for the collapsed preview without serializing megabytes. */
export function toolPayloadPreview(value: unknown): { text: string; truncated: boolean } {
  const text = typeof value === "string" ? value : safeStringify(value);
  return text.length > TOOL_PREVIEW_CHARS
    ? { text: `${text.slice(0, TOOL_PREVIEW_CHARS)}…`, truncated: true }
    : { text, truncated: false };
}

export function toolPayloadFull(value: unknown): string {
  return typeof value === "string" ? value : safeStringify(value, 2);
}

function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, undefined, space) ?? String(value);
  } catch {
    return String(value);
  }
}
