import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { MirrorCodingRelay } = await import("../electron/main/mirrorcoding/relay.ts");
const { compileCatalog } = await import("../electron/main/mirrorcoding/catalog.ts");

for (const endpoint of ["openai", "openai-response"]) test("catalog authorizes " + endpoint + " for Claude without a name override", async () => {
  const id = "vendor/CLAUDE-opus-thinking";
  const model = { id, modes: ["text"], supportedEndpointTypes: [endpoint], fast: { enabled: true, supportedEndpointTypes: [endpoint] } };
  const group = { id: "中文组", name: "QA", description: "", ratio: 0.06, dynamicBilling: false, models: [model] };
  const path = endpoint === "openai" ? "/mc/chat" : "/mc/responses";
  const catalog = { user: { id: 42, displayName: "QA" }, groups: [group], supportedEndpoints: { [endpoint]: { method: "POST", path } } };
  const metadata = compileCatalog(catalog, { findModel: () => undefined }).groups[0].metadata;
  const calls = []; let refreshes = 0;
  const relay = new MirrorCodingRelay({
    snapshot: () => ({ status: "connected", account: { id: 42 }, catalog }),
    groupUnavailable: async () => { refreshes++; },
    request: async (route, init) => {
      calls.push({ route, headers: new Headers(init.headers), body: JSON.parse(init.body.toString()) });
      return new Response(JSON.stringify({ error: { code: "upstream_unavailable" } }), { status: 503, headers: { "retry-after": "7" } });
    },
  });
  try {
    const binding = await relay.bind("provider", metadata, id, "session");
    assert.equal(binding.api, endpoint === "openai" ? "openai-completions" : "openai-responses");
    assert.equal(binding.fastAvailable, true);
    const payload = { model: id, reasoning_effort: "max", max_completion_tokens: 8192, service_tier: "fast" };
    const suffix = endpoint === "openai" ? "/chat/completions" : "/responses";
    const send = (body = payload, route = suffix) => fetch(binding.baseUrl + route, { method: "POST", headers: { ...binding.headers, "content-type": "application/json", authorization: "Bearer " + binding.apiKey }, body: JSON.stringify(body) });
    const response = await send();
    assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "7");
    assert.equal(calls.length, 1); assert.equal(calls[0].route, path);
    assert.deepEqual(calls[0].body, payload);
    assert.equal(calls[0].headers.get("x-mirrorcoding-group"), encodeURIComponent(group.id));
    assert.equal(calls[0].headers.get("x-api-key"), null);
    assert.equal(calls[0].headers.get("authorization"), null, "only the main account service supplies MC authorization");
    assert.equal((await send({ ...payload, service_tier: "priority" })).status, 400);
    model.fast.enabled = false;
    assert.equal((await send()).status, 400); assert.equal(refreshes, 1);
    assert.equal(calls.length, 1, "rejected Fast is never downgraded or forwarded");
    group.models = [];
    assert.equal((await send()).status, 403);
    assert.equal(calls.length, 1, "revoked model never reaches upstream");
  } finally { relay.dispose(); }
});
