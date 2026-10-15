import { describe, expect, it } from "vitest";
import { parseImageCapability, validateImageOptions, type ImageGenerationCapability } from "./images.js";

const capability: ImageGenerationCapability = {
  generation_path: "/v1/images/generations",
  reference_path: "/v1/images/edits",
  sizes: ["1024x1024"],
  qualities: ["high"],
  max_count: 2,
  supports_chat: false,
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

  it("parses the server's snake-case capability without accepting an unknown route", () => {
    expect(parseImageCapability(capability)).toEqual(capability);
    expect(() => parseImageCapability({ ...capability, generation_path: "/v1/images/other" })).toThrow("invalid_image_capability");
  });
});
