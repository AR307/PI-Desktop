import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { compileCatalog, parseCatalog } = await import("../electron/main/mirrorcoding/catalog.ts");

const image = {
  generation_path: "/v1/images/generations",
  max_count: 1,
  supports_chat: false,
};

const catalog = {
  user: { id: 7, display_name: "ada" },
  supported_endpoints: {
    openai: { path: "/v1/chat/completions", method: "POST" },
    "image-generation": { path: "/custom/images", method: "POST" },
  },
  groups: [
    {
      id: "fast",
      name: "Fast",
      description: "",
      ratio: 1,
      dynamic_billing: false,
      models: [
        { id: "chat-only", supported_endpoint_types: ["openai"] },
        { id: "image-a", supported_endpoint_types: ["image-generation"], image },
      ],
    },
    {
      id: "slow",
      name: "Slow",
      description: "",
      ratio: 2,
      dynamic_billing: false,
      models: [
        { id: "image-a", supported_endpoint_types: ["image-generation"], image },
      ],
    },
  ],
};

test("every account image model is kept, even when the endpoint path differs", () => {
  const compiled = compileCatalog(catalog, { findModel: () => undefined });
  assert.equal(compiled.groups.length, 2);
  assert.deepEqual(Object.keys(compiled.groups[0].metadata.imageModels), ["image-a"]);
  assert.deepEqual(Object.keys(compiled.groups[1].metadata.imageModels), ["image-a"]);
  assert.equal(compiled.groups[0].metadata.imageModels["image-a"].generation_path, "/v1/images/generations");
  assert.equal("chat-only" in compiled.groups[0].metadata.imageModels, false);
  assert.equal(compiled.groups[0].metadata.routes["chat-only"], "openai");
  assert.equal(compiled.groups[0].metadata.routes["image-a"], undefined);
});

test("a nonstandard generation path stays visible and cannot be sent", () => {
  const parsed = parseCatalog({
    success: true,
    data: {
      user: { id: 7, display_name: "ada" },
      supported_endpoints: {
        openai: { path: "/v1/chat/completions", method: "POST" },
        "image-generation": { path: "/custom/images", method: "POST" },
      },
      groups: [{
        id: "fast",
        name: "Fast",
        description: "",
        ratio: 1,
        dynamic_billing: false,
        models: [
          { id: "image-odd", supported_endpoint_types: ["image-generation"], image: { generation_path: "/v1/images/other", max_count: 1, supports_chat: false } },
          { id: "image-a", supported_endpoint_types: ["image-generation"], image },
        ],
      }],
    },
  });
  assert.equal(parsed.groups[0].models.length, 2);
  const compiled = compileCatalog(parsed, { findModel: () => undefined });
  assert.equal(compiled.groups[0].metadata.imageModels["image-odd"].generation_path, "/v1/images/other");
  assert.equal(compiled.groups[0].metadata.imageModels["image-odd"].sendable, false);
  assert.equal(compiled.groups[0].metadata.imageModels["image-a"].sendable, true);
  assert.equal(compiled.groups[0].metadata.imageModels["image-a"].generation_path, "/v1/images/generations");
});

test("account image model names stay in the image list without a server image object", () => {
  const parsed = parseCatalog({
    success: true,
    data: {
      user: { id: 7, display_name: "ada" },
      supported_endpoints: {
        openai: { path: "/v1/chat/completions", method: "POST" },
        "openai-response": { path: "/v1/responses", method: "POST" },
      },
      groups: [{
        id: "fast",
        name: "Fast",
        description: "",
        ratio: 1,
        dynamic_billing: false,
        models: [
          { id: "gpt-image-2.5", supported_endpoint_types: ["openai"] },
          { id: "grok-imagine-image", supported_endpoint_types: ["openai-response"] },
          { id: "grok-imagine-video", supported_endpoint_types: ["openai-response"] },
          { id: "gpt-5.4", supported_endpoint_types: ["openai"] },
          { id: "broken-image", supported_endpoint_types: ["openai"], image: { generation_path: "" } },
        ],
      }],
    },
  });
  const compiled = compileCatalog(parsed, { findModel: () => undefined });
  const images = compiled.groups[0].metadata.imageModels;
  assert.equal(images["gpt-image-2.5"].sendable, true);
  assert.equal(images["grok-imagine-image"].generation_path, "/v1/images/generations");
  assert.equal("grok-imagine-video" in images, false);
  assert.equal("gpt-5.4" in images, false);
  assert.equal(images["broken-image"].sendable, true);
  assert.equal(compiled.groups[0].metadata.routes["gpt-image-2.5"], undefined);
  assert.equal(compiled.groups[0].metadata.routes["gpt-5.4"], "openai");
  assert.equal(compiled.groups[0].models.some((model) => model.id === "gpt-image-2.5"), true);
});
