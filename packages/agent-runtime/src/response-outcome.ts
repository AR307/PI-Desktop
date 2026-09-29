import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AssistantReplay, ResponseDiagnostics, UiMessage } from "@pi-desktop/shared";
import type { ClassifiedAgentError } from "./agent-errors.js";

export function responseContentFacts(message: Pick<AssistantMessage, "content">) {
  let textLength = 0;
  let thinkingLength = 0;
  let toolCallCount = 0;
  let meaningful = false;
  for (const block of message.content) {
    if (block.type === "text") {
      textLength += block.text.length;
      meaningful ||= Boolean(block.text.trim());
    }
    if (block.type === "thinking") {
      thinkingLength += block.thinking.length;
      meaningful ||= Boolean(block.thinking.trim() || block.thinkingSignature || block.redacted);
    }
    if (
      block.type === "toolCall" &&
      (block.id || block.name || Object.keys(block.arguments ?? {}).length)
    ) {
      toolCallCount++;
      meaningful = true;
    }
    if (block.type === "hostedSearch") {
      toolCallCount++;
      meaningful = true;
    }
  }
  return { textLength, thinkingLength, toolCallCount, meaningful };
}

/** Provider termination takes precedence over content; never infer token limits. */
export function responseOutcome(message: AssistantMessage): ResponseDiagnostics["end"] {
  if (message.stopReason === "aborted") return "aborted";
  if (message.stopReason === "error" || message.stopReason === "pending") return "interrupted";
  if (message.stopReason === "length") return "truncated";
  const facts = responseContentFacts(message);
  if (facts.toolCallCount || message.stopReason === "deferred") return "complete";
  if (message.content.some((block) => block.type === "text" && block.text.trim()))
    return "complete";
  return facts.meaningful ? "thinking-only" : "empty";
}

export function responseOutcomeError(
  end: ResponseDiagnostics["end"],
): ClassifiedAgentError | undefined {
  if (end === "thinking-only")
    return {
      code: "MODEL_THINKING_ONLY",
      message:
        "The model returned thinking but no answer. Continue explicitly to request an answer.",
      retriable: false,
    };
  if (end === "truncated")
    return {
      code: "MODEL_OUTPUT_TRUNCATED",
      message:
        "The provider reported that the output limit was reached. The partial response has been kept.",
      retriable: false,
    };
  return undefined;
}

/** Retain real native signatures, never streaming scratch or unfinished calls. */
export function assistantReplay(message: AssistantMessage): AssistantReplay {
  const blocks: AssistantReplay["blocks"] = [];
  for (const block of message.content) {
    if (block.type === "text")
      blocks.push({
        type: "text",
        text: block.text,
        ...(block.textSignature ? { textSignature: block.textSignature } : {}),
      });
    if (block.type === "thinking")
      blocks.push({
        type: "thinking",
        thinking: block.thinking,
        ...(block.thinkingSignature ? { thinkingSignature: block.thinkingSignature } : {}),
        ...(block.redacted ? { redacted: true } : {}),
      });
  }
  return {
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.providerThinkingLevel
      ? { providerThinkingLevel: message.providerThinkingLevel }
      : {}),
    blocks,
  };
}

export function restoredAssistantBlocks(replay: AssistantReplay): AssistantMessage["content"] {
  return replay.blocks.filter((block) =>
    block.type === "text"
      ? Boolean(block.text.trim() || block.textSignature)
      : Boolean(block.thinkingSignature),
  );
}

export function canRestorePartialResponse(message: UiMessage): boolean {
  return (
    ["thinking-only", "truncated", "interrupted"].includes(
      message.responseDiagnostics?.end ?? "",
    ) && Boolean(message.content.trim() || message.assistantReplay?.blocks.length)
  );
}

export function responseDiagnostics(
  message: AssistantMessage,
  attempts: number,
): ResponseDiagnostics {
  const { meaningful: _meaningful, ...facts } = responseContentFacts(message);
  return {
    ...facts,
    end: responseOutcome(message),
    stopReason: message.stopReason,
    ...(message.rawStopReason ? { rawStopReason: message.rawStopReason } : {}),
    api: message.api,
    model: message.model,
    attempts,
    ...(message.responseId ? { requestId: message.responseId } : {}),
    // pi initializes missing usage to zero. Do not present those placeholders
    // as measured usage; only include nonzero reported fields.
    ...(Object.values(message.usage ?? {}).some((value) => typeof value === "number" && value > 0)
      ? {
          usage: Object.fromEntries(
            Object.entries(message.usage).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
            ),
          ),
        }
      : {}),
  };
}
