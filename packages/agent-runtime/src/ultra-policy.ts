import type { AgentTurnContext } from "@earendil-works/pi-agent-core";
import { highestThinkingLevel, SESSION_THINKING_LEVELS, type SubagentDefinition, type SessionThinkingLevel, type UltraThinkingCapabilities } from "@pi-desktop/shared";
import { clampThinkingLevel } from "./thinking-level.js";

const ordinary = "Do the work yourself by default. Delegate only bounded, independent tasks with a clear benefit over direct execution.";
const proactive = "Ultra is enabled. Proactively split substantial, independently actionable work into parallel subagents. Give each a complete brief, necessary context, non-overlapping file ownership and a concrete deliverable. Issue multiple Task calls together for genuine parallelism, then hand off this turn while they run. Keep simple questions and small edits local; never create workers just to meet a quota. Integrate reports, resolve contradictions and verify the final result yourself. Ask the user directly when a decision is needed.";

export function delegationGuidance(ultra: boolean): string {
  return ultra ? proactive : ordinary;
}

export function delegationSystemPrompt(ultra: boolean): string {
  return ["## Delegation", delegationGuidance(ultra),
    "No recursive delegation, duplicate work, or agent debates.",
    "Honor the user's requested delegate model and channel by using the exact catalog key on every new Task. A failed delegation does not authorize substituting the parent model or taking over that assigned work. Keep unrelated work moving, resume the same delegation when its binding is available, and report an unavailable binding instead of claiming a different model fulfilled it.",
    "Allow at most one optional review pass unless the user requests more. Fix and retest concrete, in-scope defects without restarting broad reviews.",
    "Do not invent objections or turn speculative risks into blockers. Stop when the requested work is complete and relevant checks pass, or report a genuine blocker.",
    delegationHandoffGuidance(ultra),
  ].join("\n");
}

/** A successful Task batch yields only after pi has recorded every tool result. */
export function shouldHandOffDelegations(
  turn: Pick<AgentTurnContext, "message" | "toolResults">,
  wasStarted: (delegationId: string) => boolean,
): boolean {
  if (turn.message.stopReason !== "toolUse" && turn.message.stopReason !== "stop") return false;
  return turn.toolResults.some(result => {
    const details: unknown = result.details;
    return result.toolName === "Task" && !result.isError
      && typeof details === "object" && details !== null
      && "status" in details && details.status === "running"
      && "delegationId" in details && typeof details.delegationId === "string"
      && wasStarted(details.delegationId);
  });
}

export function delegationHandoffGuidance(ultra: boolean): string {
  return ultra
    ? "After a successful Task batch, the runtime ends this parent turn normally. Workers keep running; their reports silently wake you to integrate the results. Do not poll TaskWait/TaskList or invent more work to stay busy. Put every independent worker for this dispatch in the same Task-only batch."
    : "You may keep working or end your turn while delegates run. Use TaskWait when the next step needs a report; their reports are delivered automatically. TaskStop explicitly cancels a delegate.";
}

export function isSubagentThinkingLevel(value: unknown): value is SessionThinkingLevel {
  return typeof value === "string" && (SESSION_THINKING_LEVELS as readonly string[]).includes(value);
}

export function resolveDelegationThinking(options: {
  provider: UltraThinkingCapabilities;
  definition: Pick<SubagentDefinition, "source" | "thinkingLevel">;
  requested?: unknown;
  resumed?: SessionThinkingLevel;
  parent: SessionThinkingLevel;
  ultra: boolean;
}): SessionThinkingLevel {
  const { provider, definition } = options;
  const explicit = options.requested ?? options.resumed
    ?? (options.ultra && definition.source === "user" ? definition.thinkingLevel : undefined);
  if (explicit !== undefined) {
    if (!isSubagentThinkingLevel(explicit) || (explicit !== "omit" && !provider.supportedThinkingLevels.includes(explicit))) {
      throw new Error("SUBAGENT_THINKING_UNAVAILABLE: Choose an explicitly supported native thinking level or omit the override.");
    }
    return explicit;
  }
  if (options.ultra) return highestThinkingLevel(provider);
  return definition.thinkingLevel === "omit" ? "omit"
    : clampThinkingLevel(provider, definition.thinkingLevel ?? options.parent);
}
