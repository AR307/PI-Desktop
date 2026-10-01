import { describe, expect, it } from "vitest";
import { highestThinkingLevel } from "./ultra.js";
describe("Ultra native reasoning", () => {
  it("selects only the highest explicitly supported native level", () => {
    expect(highestThinkingLevel({ supportsReasoning: true, supportedThinkingLevels: ["high", "off", "low"] })).toBe("high");
    expect(highestThinkingLevel({ supportsReasoning: true, supportedThinkingLevels: ["max", "high"] })).toBe("max");
  });
  it("omits undeclared reasoning instead of inventing a level", () => {
    expect(highestThinkingLevel({ supportsReasoning: false, supportedThinkingLevels: ["off"] })).toBe("omit");
    expect(highestThinkingLevel({ supportsReasoning: true, supportedThinkingLevels: [] })).toBe("omit");
  });
});
