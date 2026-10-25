import { describe, expect, it } from "vitest";
import { supportsClaudeCacheTtl } from "./claude-cache.js";

describe("Claude cache settings availability", () => {
  it("uses model identity or family, not a display alias", () => {
    expect(supportsClaudeCacheTtl("claude-sonnet-4-6", "anthropic_messages")).toBe(true);
    expect(supportsClaudeCacheTtl("anthropic/claude-opus-4-6", "anthropic-messages")).toBe(true);
    expect(supportsClaudeCacheTtl("private-route", "anthropic_messages", "claude")).toBe(true);
    expect(supportsClaudeCacheTtl("gpt-5", "anthropic_messages")).toBe(false);
    expect(supportsClaudeCacheTtl("glm-5", "anthropic_messages")).toBe(false);
  });
  it("excludes protocols that do not carry Anthropic cache controls", () => {
    for (const api of ["chat_completions", "responses", "google_generative_ai", "pi_messages"]) {
      expect(supportsClaudeCacheTtl("claude-sonnet-4-6", api)).toBe(false);
    }
    expect(supportsClaudeCacheTtl("claude-sonnet-4-6", "auto")).toBe(true);
  });
});
