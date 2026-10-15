import type { UiMessage, SubagentRunStatus } from "./types.js";

/** Runtime-owned return, not a tool call authored by the parent model. */
export const RETURN_TO_PARENT_TOOL = "ReturnToParent";
export type SubagentReturnStatus = SubagentRunStatus | "stopped";
export type SubagentReturnDetails = {
  kind: "subagent-return";
  delegationId: string;
  agent: string;
  status: SubagentReturnStatus;
  report: string;
  modelId?: string;
  modelKey?: string;
  groupId?: string;
  thinkingLevel?: string;
  fast?: boolean;
};

export function isReturnToParent(message: Pick<UiMessage, "toolName">): boolean {
  return message.toolName === RETURN_TO_PARENT_TOOL;
}

export function subagentReturnDetails(message: Pick<UiMessage, "toolName" | "toolResult">): SubagentReturnDetails | undefined {
  if (!isReturnToParent(message) || !message.toolResult || typeof message.toolResult !== "object") return undefined;
  const details = (message.toolResult as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const value = details as Partial<SubagentReturnDetails>;
  if (value.kind !== "subagent-return" || typeof value.delegationId !== "string" ||
    typeof value.agent !== "string" || typeof value.report !== "string" ||
    !["completed", "failed", "timed_out", "aborted", "stopped"].includes(value.status ?? "")) return undefined;
  return value as SubagentReturnDetails;
}

/** Both clients use the same truthful terminal label. */
export function subagentReturnLabel(status?: SubagentReturnStatus): string {
  return status === "completed" ? "chat.subagentReturnCompleted" :
    status === "stopped" || status === "aborted" ? "chat.subagentReturnStopped" :
    "chat.subagentReturnFailed";
}
