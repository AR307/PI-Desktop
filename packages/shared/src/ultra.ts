import { THINKING_LEVELS, type SessionThinkingLevel, type ThinkingLevel } from "./types.js";

/** UI selection only. Ultra is never a provider reasoning level. */
export type ThinkingSelection = SessionThinkingLevel | "ultra";

export type UltraThinkingCapabilities = {
  supportsReasoning: boolean;
  supportedThinkingLevels: readonly ThinkingLevel[];
};

/** Only explicitly declared native levels may reach an adapter. */
export function highestThinkingLevel(capabilities: UltraThinkingCapabilities): SessionThinkingLevel {
  if (!capabilities.supportsReasoning) return "omit";
  return [...THINKING_LEVELS].reverse().find((level) =>
    level !== "off" && capabilities.supportedThinkingLevels.includes(level),
  ) ?? "omit";
}

/** Native tier prefix for the localized Ultra summary; never infer a tier. */
export function ultraReasoningPrefix(capabilities: UltraThinkingCapabilities): string {
  const level = highestThinkingLevel(capabilities);
  return level === "omit" ? "" : `${level.charAt(0).toUpperCase()}${level.slice(1)} + `;
}
