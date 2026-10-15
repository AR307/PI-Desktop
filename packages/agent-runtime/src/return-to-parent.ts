import { RETURN_TO_PARENT_TOOL, type UiMessage, type SubagentReturnStatus } from "@pi-desktop/shared";
import { taskMessageSnapshot } from "./delegation-message.js";

/** Execute the child's terminal return once; no extra model round is needed.
 * The host persists this native tool result. Existing report delivery owns
 * parent-context injection and waking; this operation never creates a user row.
 */
export function returnToParent(input: {
  delegationId: string;
  agent: string;
  status: SubagentReturnStatus;
  report: string;
  completedAt: number;
  summary: Record<string, unknown>;
}): UiMessage {
  const details = {
    ...input.summary,
    kind: "subagent-return",
    delegationId: input.delegationId,
    agent: input.agent,
    status: input.status,
    report: input.report,
  };
  return taskMessageSnapshot({
    toolCallId: input.delegationId + ":return",
    toolName: RETURN_TO_PARENT_TOOL,
    args: { delegationId: input.delegationId, agent: input.agent },
    startedAt: input.completedAt,
    endedAt: input.completedAt,
    result: { content: [{ type: "text", text: input.report }], details },
  });
}
