import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createViteServer({
  root: desktop,
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { MirrorCodingRelay } = await vite.ssrLoadModule("/electron/main/mirrorcoding/relay.ts");

const image = {
  generation_path: "/v1/images/generations",
  max_count: 1,
  supports_chat: false,
};
const metadata = {
  accountId: 7,
  groupId: "fast",
  groupName: "Fast",
  description: "",
  ratio: 1,
  dynamicBilling: false,
  routes: { "chat-a": "openai" },
  imageModels: { "image-a": image },
};
const catalog = {
  groups: [{
    id: "fast",
    models: [
      { id: "chat-a", supported_endpoint_types: ["openai"] },
      { id: "chat-b", supported_endpoint_types: ["anthropic"] },
      { id: "image-a", supported_endpoint_types: ["image-generation"], image },
    ],
  }],
};

const multiModelMetadata = {
  ...metadata,
  routes: { "chat-a": "openai", "chat-b": "anthropic" },
};

function account(onRequest) {
  return {
    snapshot: () => ({ status: "connected", account: { id: 7 }, catalog }),
    request: async (path, init) => {
      const body = typeof init.body === "string" ? init.body : Buffer.from(init.body ?? []).toString("utf8");
      onRequest({
        path,
        headers: Object.fromEntries(init.headers.entries()),
        body,
        bodyType: typeof init.body,
        bodyIsUint8Array: init.body instanceof Uint8Array,
      });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers,
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test.after(async () => { await vite.close(); });

test("chat forwarding keeps sidecar headers and drops the local relay key", async () => {
  let seen;
  const relay = new MirrorCodingRelay(account((value) => { seen = value; }));
  const binding = await relay.bind("provider-1", metadata, "chat-a", "session-1");
  const status = await post(
    `${binding.baseUrl}/chat/completions`,
    {
      "content-type": "application/json",
      "x-pi-mirrorcoding-key": binding.headers["x-pi-mirrorcoding-key"],
      "anthropic-beta": "interleaved-thinking",
      "x-custom": "keep",
      connection: "close",
    },
    JSON.stringify({ model: "chat-a" }),
  );
  assert.equal(status, 200);
  assert.equal(seen.path, "/v1/chat/completions");
  assert.equal(seen.headers["anthropic-beta"], "interleaved-thinking");
  assert.equal(seen.headers["x-custom"], "keep");
  assert.equal(seen.headers["x-pi-mirrorcoding-key"], undefined);
  assert.equal(seen.headers.connection, undefined);
  assert.equal(seen.headers["x-mirrorcoding-group"], encodeURIComponent("fast"));
  assert.equal(seen.bodyType, "string");
  relay.dispose();
});

test("image forwarding still requires the image endpoint", async () => {
  let seen = false;
  const relay = new MirrorCodingRelay(account(() => { seen = true; }));
  const binding = await relay.bindImage("provider-1", metadata, "image-a", "session-1");
  const status = await post(
    `${binding.baseUrl}/v1/chat/completions`,
    {
      "content-type": "application/json",
      "x-pi-mirrorcoding-key": binding.headers["x-pi-mirrorcoding-key"],
    },
    JSON.stringify({ model: "image-a" }),
  );
  assert.equal(status, 403);
  assert.equal(seen, false);
  binding.release();
  relay.dispose();
});

test("one session keeps separate relay bindings when it switches model or protocol", async () => {
  const seen = [];
  const relay = new MirrorCodingRelay(account((value) => { seen.push(value); }));
  const chat = await relay.bind("provider-1", multiModelMetadata, "chat-a", "session-1");
  const messages = await relay.bind("provider-1", multiModelMetadata, "chat-b", "session-1");
  assert.notEqual(chat.apiKey, messages.apiKey);

  const wrongModel = await post(
    `${chat.baseUrl}/chat/completions`,
    { "content-type": "application/json", "x-pi-mirrorcoding-key": chat.apiKey },
    JSON.stringify({ model: "chat-b" }),
  );
  assert.equal(wrongModel, 403);
  assert.equal(seen.length, 0);

  assert.equal(
    await post(
      `${chat.baseUrl}/chat/completions`,
      { "content-type": "application/json", "x-pi-mirrorcoding-key": chat.apiKey },
      JSON.stringify({ model: "chat-a" }),
    ),
    200,
  );
  assert.equal(
    await post(
      `${messages.baseUrl}/v1/messages`,
      { "content-type": "application/json", "x-pi-mirrorcoding-key": messages.apiKey },
      JSON.stringify({ model: "chat-b" }),
    ),
    200,
  );
  assert.deepEqual(seen.map((request) => ({ path: request.path, group: request.headers["x-mirrorcoding-group"] })), [
    { path: "/v1/chat/completions", group: "fast" },
    { path: "/v1/messages", group: "fast" },
  ]);
  relay.dispose();
});

test("image generations JSON and edits multipart are forwarded unchanged", async () => {
  let seen;
  const relay = new MirrorCodingRelay(account((value) => { seen = value; }));
  const binding = await relay.bindImage("provider-1", metadata, "image-a", "session-1");
  const key = binding.headers["x-pi-mirrorcoding-key"];
  const generated = await post(
    `${binding.baseUrl}/v1/images/generations`,
    { "content-type": "application/json", "x-pi-mirrorcoding-key": key },
    JSON.stringify({ model: "image-a", prompt: "cat", n: 1 }),
  );
  assert.equal(generated, 200);
  assert.equal(seen.path, "/v1/images/generations");
  assert.deepEqual(JSON.parse(seen.body), { model: "image-a", prompt: "cat", n: 1 });
  assert.equal(seen.body.includes("size"), false);
  assert.equal(seen.headers["x-pi-mirrorcoding-key"], undefined);
  assert.equal(seen.bodyType, "string");

  const edited = await post(
    `${binding.baseUrl}/v1/images/edits`,
    { "content-type": "multipart/form-data; boundary=pi", "x-pi-mirrorcoding-key": key },
    "--pi\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\ncat\r\n--pi--\r\n",
  );
  assert.equal(edited, 200);
  assert.equal(seen.path, "/v1/images/edits");
  assert.equal(seen.body.includes("name=\"prompt\""), true);
  assert.equal(seen.headers["content-type"].includes("multipart/form-data"), true);
  assert.equal(seen.bodyIsUint8Array, true);

  const other = await post(
    `${binding.baseUrl}/v1/images/other`,
    { "content-type": "application/json", "x-pi-mirrorcoding-key": key },
    JSON.stringify({ model: "image-a" }),
  );
  assert.equal(other, 403);
  binding.release();
  relay.dispose();
});

test("a nonstandard image route is not forwarded", async () => {
  let seen = false;
  const odd = {
    ...metadata,
    imageModels: {
      "image-odd": { generation_path: "/v1/images/other", max_count: 1, supports_chat: false, sendable: false },
    },
  };
  const relay = new MirrorCodingRelay({
    snapshot: () => ({
      status: "connected",
      account: { id: 7 },
      catalog: {
        groups: [{
          id: "fast",
          models: [{
            id: "image-odd",
            supported_endpoint_types: ["image-generation"],
            image: { generation_path: "/v1/images/other", max_count: 1, supports_chat: false, sendable: false },
          }],
        }],
      },
    }),
    request: async () => {
      seen = true;
      return new Response("{}");
    },
  });
  const binding = await relay.bindImage("provider-1", odd, "image-odd", "session-1");
  const status = await post(
    `${binding.baseUrl}/v1/images/generations`,
    { "content-type": "application/json", "x-pi-mirrorcoding-key": binding.headers["x-pi-mirrorcoding-key"] },
    JSON.stringify({ model: "image-odd", prompt: "cat", n: 1 }),
  );
  assert.equal(status, 403);
  assert.equal(seen, false);
  binding.release();
  relay.dispose();
});
