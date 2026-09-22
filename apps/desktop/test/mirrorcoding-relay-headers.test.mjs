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
      { id: "image-a", supported_endpoint_types: ["image-generation"], image },
    ],
  }],
};

function account(onRequest) {
  return {
    snapshot: () => ({ status: "connected", account: { id: 7 }, catalog }),
    request: async (path, init) => {
      onRequest({ path, headers: Object.fromEntries(init.headers.entries()) });
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
