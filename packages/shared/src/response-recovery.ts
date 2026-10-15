import type { UiMessage } from "./types/messages.js";

/** Continue appends a user turn; it never regenerates an earlier submission. */
export function canContinueResponse(message: UiMessage): boolean {
  if (message.role !== "assistant" || message.parentToolCallId || message.status !== "error")
    return false;
  return (
    ["thinking-only", "truncated", "interrupted"].includes(
      message.responseDiagnostics?.end ?? "",
    ) ||
    ["EMPTY_MODEL_RESPONSE", "MODEL_THINKING_ONLY", "MODEL_OUTPUT_TRUNCATED"].includes(
      message.error?.code ?? "",
    )
  );
}
