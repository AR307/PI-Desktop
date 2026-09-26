import { describe, expect, it } from "vitest";
import type { AgentEvent, RacpEventEnvelope, UiMessage } from "@pi-desktop/shared";
import { applyTranscriptEvent, mergeMessages } from "../src/state/transcript";

const message: UiMessage = { id: "assistant-one", role: "assistant", content: "", createdAt: "2026-09-21T10:00:00.000Z", status: "streaming" };
function event(value: AgentEvent): RacpEventEnvelope { return { eventId: "e", scope: "session", sessionId: "s", epoch: "epoch", sequence: 1, revision: 1, kind: "item.delta", occurredAt: message.createdAt, payload: { event: value } }; }

describe("live conversation", () => {
  it("shows reasoning and text while tools run, then reconciles history without duplicate messages", () => {
    let messages: UiMessage[] = [];
    messages = applyTranscriptEvent(messages, event({ type: "message_start", message }));
    messages = applyTranscriptEvent(messages, event({ type: "message_update", message, stream: "delta", deltaThinking: "Inspecting the app." }));
    messages = applyTranscriptEvent(messages, event({ type: "message_update", message, stream: "delta", deltaText: "I found " }));
    messages = applyTranscriptEvent(messages, event({ type: "message_update", message, stream: "delta", deltaText: "the issue." }));
    messages = applyTranscriptEvent(messages, event({ type: "tool_start", toolCallId: "read-one", toolName: "Read", args: { path: "app.ts" } }));
    messages = applyTranscriptEvent(messages, event({ type: "tool_update", toolCallId: "read-one", partialResult: "partial file" }));
    expect(messages[0]).toMatchObject({ content: "I found the issue.", thinking: "Inspecting the app." });
    expect(messages[1]).toMatchObject({ toolName: "Read", toolStatus: "running", toolResult: "partial file" });
    messages = applyTranscriptEvent(messages, event({ type: "tool_end", toolCallId: "read-one", result: "full file" }));
    messages = applyTranscriptEvent(messages, event({ type: "message_end", message: { ...message, content: "Fixed.", status: "complete" } }));
    const restored = mergeMessages(messages, [{ ...message, content: "Fixed.", status: "complete" }]);
    expect(restored).toHaveLength(2); expect(restored[1].toolStatus).toBe("success");
  });

  it("replaces an optimistic phone message with the canonical desktop message", () => {
    const pending: UiMessage = { ...message, id: "phone-id", role: "user", content: "Continue" };
    const canonical: UiMessage = { ...pending, id: "desktop-id", status: "complete" };
    expect(applyTranscriptEvent([pending], event({ type: "user_message_persisted", optimisticMessageId: pending.id, message: canonical }))).toEqual([canonical]);
  });

  it("keeps unchanged rows identical so memoized components skip re-rendering", () => {
    const older: UiMessage = { ...message, id: "older", createdAt: "2026-09-21T09:00:00.000Z", status: "complete" };
    const tail: UiMessage = { ...message, id: "tail", createdAt: "2026-09-21T11:00:00.000Z" };
    const merged = mergeMessages([older, message], [tail]);
    expect(merged.map((row) => row.id)).toEqual(["older", "assistant-one", "tail"]);
    // Append fast path: existing rows keep identity, no re-sort of the head.
    expect(merged[0]).toBe(older);
    expect(merged[1]).toBe(message);
    // A tool update without a matching row changes nothing, including identity.
    const untouched = applyTranscriptEvent(merged, event({ type: "tool_update", toolCallId: "missing", partialResult: "x" }));
    expect(untouched).toBe(merged);
    // A matching update replaces only its own row.
    const started = applyTranscriptEvent(merged, event({ type: "tool_start", toolCallId: "call-1", toolName: "Read", args: {} }));
    const updated = applyTranscriptEvent(started, event({ type: "tool_update", toolCallId: "call-1", partialResult: "x" }));
    expect(updated[0]).toBe(started[0]);
    expect(updated.find((row) => row.toolCallId === "call-1")?.toolResult).toBe("x");
  });

  it("orders an out-of-order backfill without dropping rows", () => {
    const tail: UiMessage = { ...message, id: "tail", createdAt: "2026-09-21T11:00:00.000Z" };
    const early: UiMessage = { ...message, id: "early", createdAt: "2026-09-21T08:00:00.000Z" };
    const merged = mergeMessages([message, tail], [early]);
    expect(merged.map((row) => row.id)).toEqual(["early", "assistant-one", "tail"]);
  });
});
