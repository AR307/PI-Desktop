import { describe, expect, it } from "vitest";
import { highestThinkingLevel, ultraReasoningPrefix } from "./ultra.js";
describe("Ultra native reasoning", () => {
  it("selects only the highest explicitly supported native level", () => {
    expect(highestThinkingLevel({ supportsReasoning: true, supportedThinkingLevels: ["high", "off", "low"] })).toBe("high");
    expect(highestThinkingLevel({ supportsReasoning: true, supportedThinkingLevels: ["max", "high"] })).toBe("max");
  });
  it("omits undeclared reasoning instead of inventing a level", () => {
    expect(highestThinkingLevel({ supportsReasoning: false, supportedThinkingLevels: ["off"] })).toBe("omit");
    expect(highestThinkingLevel({ supportsReasoning: true, supportedThinkingLevels: [] })).toBe("omit");
  });
  it("labels Max and Xhigh from capabilities rather than a model family", () => {
    expect(ultraReasoningPrefix({ supportsReasoning: true, supportedThinkingLevels: ["max", "high", "low"] })).toBe("Max + ");
    expect(ultraReasoningPrefix({ supportsReasoning: true, supportedThinkingLevels: ["high", "xhigh", "low"] })).toBe("Xhigh + ");
    expect(ultraReasoningPrefix({ supportsReasoning: true, supportedThinkingLevels: ["high", "medium"] })).toBe("High + ");
  });
  it("does not claim a native tier when the model has none", () => {
    expect(ultraReasoningPrefix({ supportsReasoning: false, supportedThinkingLevels: ["off"] })).toBe("");
    expect(ultraReasoningPrefix({ supportsReasoning: true, supportedThinkingLevels: [] })).toBe("");
  });
});
