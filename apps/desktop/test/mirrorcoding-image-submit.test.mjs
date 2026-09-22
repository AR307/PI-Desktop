import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { imagesZhCN } = await import("../../../packages/i18n/src/locales/images.ts");
const { imageComposerReady, imageSubmitOptions } = await import("../src/features/images/image-submit.ts");
const { mirrorImageBatchRequest } = await import("../electron/main/images/batch.ts");
const { generateImageBatch } = await import("@pi-desktop/agent-runtime");

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const standard = {
  generation_path: "/v1/images/generations",
  reference_path: "/v1/images/edits",
  max_count: 2,
  supports_chat: false,
  sendable: true,
};

test("the Chinese composer image mode is 生图", () => {
  assert.equal(imagesZhCN.mode, "生图");
});

test("a MirrorCoding image model can send without a stored secret", () => {
  assert.equal(imageComposerReady({ enabled: true }, standard), true);
  assert.equal(imageComposerReady({ enabled: true }, {
    generation_path: "/v1/images/generations",
    max_count: 1,
    supports_chat: false,
  }), true);
  assert.equal(imageComposerReady({ enabled: false }, standard), false);
  assert.equal(imageComposerReady({ enabled: true }, {
    ...standard,
    generation_path: "/v1/images/other",
    sendable: false,
  }), false);
  assert.throws(
    () => imageSubmitOptions({ ...standard, sendable: false, generation_path: "/v1/images/other" }, { count: 1 }, 0),
    /model_or_group_unavailable/,
  );
});

test("composer image submit uses the local relay and drops size, quality, and ratio", async () => {
  const options = imageSubmitOptions(standard, { count: 2, size: "1024x1024", quality: "high", aspectRatio: "1:1" }, 0);
  assert.deepEqual(options, { count: 2 });
  const request = mirrorImageBatchRequest({
    baseUrl: "http://127.0.0.1:9/provider-1",
    modelId: "image-a",
    relayKey: "local-key",
    prompt: "a cat",
    count: options.count,
  });
  const calls = [];
  const results = await generateImageBatch({
    input: request.input,
    endpoint: request.endpoint,
    signal: new AbortController().signal,
    fetchImpl: async (url, init) => {
      const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      calls.push({ url: String(url), body: JSON.parse(init.body), headers });
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    save: async () => "generated.png",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://127.0.0.1:9/provider-1/v1/images/generations");
  assert.deepEqual(calls[0].body, { model: "image-a", prompt: "a cat", n: 1 });
  assert.equal("size" in calls[0].body, false);
  assert.equal("quality" in calls[0].body, false);
  assert.equal("aspect_ratio" in calls[0].body, false);
  assert.equal(calls[0].headers["x-pi-mirrorcoding-key"], "local-key");
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(results.every((row) => row.status === "succeeded"), true);
});
