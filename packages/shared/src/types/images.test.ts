import { describe, expect, it } from "vitest";
import { imageCapabilitySendable, parseImageCapability, validateImageOptions, type ImageGenerationCapability } from "./images.js";

const capability: ImageGenerationCapability = {
  generation_path: "/v1/images/generations",
  reference_path: "/v1/images/edits",
  sizes: ["1024x1024"],
  qualities: ["high"],
  max_count: 2,
  supports_chat: false,
  sendable: true,
};

describe("image generation contracts", () => {
  it("keeps only declared image options and defaults to one output", () => {
    expect(validateImageOptions(capability, { size: "1024x1024", quality: "high" }, 0)).toEqual({
      count: 1,
      size: "1024x1024",
      quality: "high",
    });
  });

  it("rejects references and values that the group did not publish", () => {
    expect(() => validateImageOptions({ ...capability, reference_path: undefined }, {}, 1)).toThrow("images_reference_unsupported");
    expect(() => validateImageOptions(capability, { size: "2048x2048" }, 0)).toThrow("images_size_unsupported");
    expect(() => validateImageOptions(capability, { count: 3 }, 0)).toThrow("images_count_unsupported");
  });

  it("keeps a standard generations route sendable", () => {
    expect(parseImageCapability(capability)).toEqual(capability);
    expect(imageCapabilitySendable(parseImageCapability(capability))).toBe(true);
  });

  it("keeps a nonstandard generation path visible and not sendable", () => {
    const parsed = parseImageCapability({ ...capability, generation_path: "/v1/images/other", reference_path: "/custom/edits" });
    expect(parsed.generation_path).toBe("/v1/images/other");
    expect(parsed.reference_path).toBeUndefined();
    expect(parsed.sendable).toBe(false);
    expect(imageCapabilitySendable(parsed)).toBe(false);
    expect(() => parseImageCapability({ ...capability, max_count: 0 })).toThrow("invalid_image_capability");
  });
});
