import { describe, expect, it } from "vitest";
import { subagentReturnDetails, subagentReturnLabel, type SubagentReturnStatus } from "@pi-desktop/shared";
import { returnToParent } from "./return-to-parent.js";

describe("runtime-owned ReturnToParent", () => {
  it.each<SubagentReturnStatus>(["completed", "failed", "timed_out", "stopped", "aborted"])("transfers a %s run without pretending the parent called a tool", status => {
    const message = returnToParent({ delegationId: "run", agent: "explorer", status, report: "Actual worker report", completedAt: 1000,
      summary: { modelId: "grok-4.7", modelKey: "provider/grok-4.7", groupId: "中文分组", thinkingLevel: "xhigh", fast: true } });
    expect(message).toMatchObject({ id: "run:return", role: "tool", toolName: "ReturnToParent", toolStatus: "success", status: "complete" });
    expect(message.parentToolCallId).toBeUndefined();
    expect(message.toolUsage).toBeUndefined();
    const details = subagentReturnDetails(message);
    expect(details).toMatchObject({ status, report: "Actual worker report", modelKey: "provider/grok-4.7", groupId: "中文分组", thinkingLevel: "xhigh" });
    expect(subagentReturnLabel(details?.status)).toBe(status === "completed" ? "chat.subagentReturnCompleted" :
      ["stopped", "aborted"].includes(status) ? "chat.subagentReturnStopped" : "chat.subagentReturnFailed");
  });
});
