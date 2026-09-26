import { describe, expect, it } from "vitest";
import { TRANSCRIPT_DISPLAY_TRUNCATION_MARKER, type UiMessage } from "@pi-desktop/shared";
import {
  buildDiffLines,
  buildTranscriptEntries,
  extractToolDiff,
  isDisplayTruncated,
  messageHasTruncatedContent,
  toolPayloadPreview,
  TOOL_PREVIEW_CHARS,
} from "../src/state/transcript-view";

function message(id: string, overrides: Partial<UiMessage> = {}): UiMessage {
  return { id, role: "assistant", content: id, createdAt: `2026-09-26T00:00:${id.padStart(2, "0")}.000Z`, ...overrides };
}

describe("transcript view projection", () => {
  it("groups delegate messages under their Task call and marks running groups", () => {
    const rows = [
      message("01"),
      message("02", { parentToolCallId: "task-1", agentName: "explorer" }),
      message("03"),
      message("04", { parentToolCallId: "task-1", status: "streaming" }),
      message("05", { parentToolCallId: "task-2", agentName: "reviewer", role: "tool", toolStatus: "success" }),
    ];
    const entries = buildTranscriptEntries(rows);
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "delegation", "message", "delegation"]);
    const first = entries[1];
    if (first?.kind !== "delegation") throw new Error("expected delegation");
    expect(first.agentName).toBe("explorer");
    expect(first.running).toBe(true);
    expect(first.messages.map((row) => row.id)).toEqual(["02", "04"]);
    const second = entries[3];
    if (second?.kind !== "delegation") throw new Error("expected delegation");
    expect(second.running).toBe(false);
  });

  it("inserts a compaction divider after the message the checkpoint cut through", () => {
    const entries = buildTranscriptEntries(
      [message("01"), message("02"), message("03")],
      [{ id: "ck-1", throughMessageId: "02" }],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "message", "compaction", "message"]);
  });

  it("detects host display truncation by the marker suffix", () => {
    const capped = `body${TRANSCRIPT_DISPLAY_TRUNCATION_MARKER}`;
    expect(isDisplayTruncated(capped)).toBe(true);
    expect(isDisplayTruncated("body")).toBe(false);
    expect(messageHasTruncatedContent(message("01", { content: capped }))).toBe(true);
    expect(messageHasTruncatedContent(message("02", { toolResult: { output: capped } }))).toBe(true);
    expect(messageHasTruncatedContent(message("03", { toolResult: ["[truncated for display]"] }))).toBe(true);
    expect(messageHasTruncatedContent(message("04"))).toBe(false);
  });

  it("extracts Edit and Write tool diffs and builds bounded line diffs", () => {
    expect(extractToolDiff("Edit", { path: "a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc" })).toEqual({ path: "a.ts", before: "a\nb\nc", after: "a\nB\nc" });
    expect(extractToolDiff("Write", { path: "a.ts", content: "fresh" })).toEqual({ path: "a.ts", before: "", after: "fresh" });
    expect(extractToolDiff("Bash", { command: "ls" })).toBeNull();
    const lines = buildDiffLines("a\nb\nc\nd", "a\nB\nc\nd");
    expect(lines).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "context", text: "c" },
      { kind: "context", text: "d" },
    ]);
  });

  it("previews large tool payloads without serializing them fully", () => {
    const big = "x".repeat(TOOL_PREVIEW_CHARS + 50);
    const preview = toolPayloadPreview(big);
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(TOOL_PREVIEW_CHARS + 1);
    expect(toolPayloadPreview("short")).toEqual({ text: "short", truncated: false });
  });
});
