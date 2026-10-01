import { highestThinkingLevel, SESSION_THINKING_LEVELS, type SubagentDefinition, type SessionThinkingLevel, type UltraThinkingCapabilities } from "@pi-desktop/shared";
import { clampThinkingLevel } from "./thinking-level.js";

const ordinary = "Do the work yourself by default. Delegate only bounded, independent tasks with a clear benefit over direct execution.";
const proactive = "Ultra is enabled. Proactively split substantial, independently actionable work into parallel subagents. Give each a complete brief, necessary context, non-overlapping file ownership and a concrete deliverable. Issue multiple Task calls together for genuine parallelism, and work on a different critical-path task yourself. Keep simple questions and small edits local; never create workers just to meet a quota. Integrate reports, resolve contradictions and verify the final result yourself. Ask the user directly when a decision is needed.";

export function delegationGuidance(ultra: boolean): string {
  return ultra ? proactive : ordinary;
}

export function delegationSystemPrompt(ultra: boolean): string {
  return ["## Delegation", delegationGuidance(ultra),
    "No recursive delegation, duplicate work, or agent debates.",
    "Allow at most one optional review pass unless the user requests more. Fix and retest concrete, in-scope defects without restarting broad reviews.",
    "Do not invent objections or turn speculative risks into blockers. Stop when the requested work is complete and relevant checks pass, or report a genuine blocker.",
    "You may end your turn while delegates run: they keep working in the background and their reports are delivered automatically. Use TaskWait when the next step needs a report; TaskStop explicitly cancels a delegate.",
  ].join("\n");
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
