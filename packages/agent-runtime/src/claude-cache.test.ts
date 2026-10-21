import { describe, expect, it } from "vitest";
import { genericModelConfig, modelConfigWithBinding } from "./model-capabilities.js";

describe("Claude cache configuration", () => {
  it.each(["5m", "1h"] as const)("keeps the saved %s preference on the effective model", (claudeCacheTtl) => {
    const config = modelConfigWithBinding(genericModelConfig("claude-sonnet-4-6"), {
      contextWindow: 200_000, maxTokens: 8192, thinkingLevels: ["off"], claudeCacheTtl,
    });
    expect(config.claudeCacheTtl).toBe(claudeCacheTtl);
  });
});
