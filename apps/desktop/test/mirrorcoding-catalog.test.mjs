import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleUrl = new URL("../electron/main/mirrorcoding/catalog.ts", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl.href && specifier === "../models-dev-catalog") {
      return nextResolve("../models-dev-catalog.ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { parseCatalog } = await import(moduleUrl.href).finally(() => hooks.deregister());

test("parses MirrorCoding catalog fields and preserves group routing data", () => {
  const catalog = parseCatalog({
    success: true,
    data: {
      user: { id: 42, displayName: "tester" },
      supportedEndpoints: {
        openai: { path: "/v1/chat/completions", method: "POST" },
      },
      groups: [{
        id: "g-main",
        name: "Main",
        description: "Primary group",
        ratio: 0.06,
        dynamicBilling: false,
        models: [{ id: "model-a", supportedEndpointTypes: ["openai"] }],
      }],
    },
  });
  assert.equal(catalog.user.displayName, "tester");
  assert.equal(catalog.groups[0].dynamicBilling, false);
  assert.deepEqual(catalog.groups[0].models[0].supportedEndpointTypes, ["openai"]);
});

test("parses documented image capability fields without inventing defaults", () => {
  const catalog = parseCatalog({
    success: true,
    data: {
      user: { id: 42, display_name: "tester" },
      supported_endpoints: {
        "image-generation": { path: "/v1/images/generations", method: "POST" },
        "image-edit": { path: "/v1/images/edits", method: "POST" },
      },
      groups: [{
        id: "g-images",
        name: "Images",
        description: "Image group",
        ratio: null,
        dynamic_billing: true,
        models: [{
          id: "gpt-image-1",
          supported_endpoint_types: ["image-generation", "image-edit"],
          image: {
            generation_path: "/v1/images/generations",
            reference_path: "/v1/images/edits",
            sizes: ["1024x1024"],
            qualities: ["auto", "high"],
            aspect_ratios: ["1:1"],
            max_count: 4,
            supports_chat: false,
          },
        }],
      }],
    },
  });
  assert.deepEqual(catalog.groups[0].models[0].image, {
    generationPath: "/v1/images/generations",
    referencePath: "/v1/images/edits",
    sizes: ["1024x1024"],
    qualities: ["auto", "high"],
    aspectRatios: ["1:1"],
    maxCount: 4,
    supportsChat: false,
  });
});

test("rejects duplicate group and model identities", () => {
  assert.throws(() => parseCatalog({
    success: true,
    data: {
      user: { id: 42, displayName: "tester" },
      supportedEndpoints: {},
      groups: [
        { id: "g", name: "one", description: "", ratio: null, dynamicBilling: true, models: [] },
        { id: "g", name: "two", description: "", ratio: null, dynamicBilling: true, models: [] },
      ],
    },
  }), /invalid_catalog/);
});
