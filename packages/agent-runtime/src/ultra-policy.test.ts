import { describe, expect, it } from "vitest";
import { delegationSystemPrompt, resolveDelegationThinking } from "./ultra-policy.js";
import type { SubagentDefinition, UltraThinkingCapabilities } from "@pi-desktop/shared";
const provider: UltraThinkingCapabilities = { supportsReasoning: true, supportedThinkingLevels: ["off", "low", "high", "max"] };
const definition: Pick<SubagentDefinition, "source" | "thinkingLevel"> = { source: "builtin", thinkingLevel: "low" };
const options = { provider, definition, parent: "high" as const, ultra: true };
describe("Ultra delegation selection", () => {
  it("uses the child model maximum, not the parent or builtin default", () => expect(resolveDelegationThinking(options)).toBe("max"));
  it("honors explicit requested and user-defined levels", () => {
    expect(resolveDelegationThinking({ ...options, requested: "low" })).toBe("low");
    expect(resolveDelegationThinking({ ...options, definition: { source: "user", thinkingLevel: "high" } })).toBe("high");
  });
  it("resumes the recorded level even after Ultra changes", () => {
    expect(resolveDelegationThinking({ ...options, ultra: false, resumed: "max" })).toBe("max");
    expect(resolveDelegationThinking({ ...options, resumed: "low" })).toBe("low");
    expect(resolveDelegationThinking({ ...options, resumed: "low", requested: "high" })).toBe("high");
  });
  it("rejects unsupported explicit levels before requesting a model", () => {
    for (const requested of ["ultra", "xhigh", "invented"]) expect(() => resolveDelegationThinking({ ...options, requested })).toThrow("SUBAGENT_THINKING_UNAVAILABLE");
  });
  it("preserves ordinary delegation defaults", () => expect(resolveDelegationThinking({ ...options, ultra: false })).toBe("low"));
  it("does not invent reasoning for a tool-capable non-reasoning model", () => expect(resolveDelegationThinking({ ...options, provider: { supportsReasoning: false, supportedThinkingLevels: [] } })).toBe("omit"));
  it("installs one coherent proactive policy, leaving ordinary delegation alone", () => {
    expect(delegationSystemPrompt(true)).toContain("Proactively split");
    expect(delegationSystemPrompt(true)).not.toContain("Do the work yourself by default");
    expect(delegationSystemPrompt(false)).toContain("Do the work yourself by default");
  });
});
