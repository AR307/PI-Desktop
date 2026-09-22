import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { compileCatalog } = await import("../electron/main/mirrorcoding/catalog.ts");

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
