import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { MirrorCodingRelay } = await import("../electron/main/mirrorcoding/relay.ts");

test("persisted OpenAI routes bind Messages and retain group authorization", async () => {
  const id = "vendor/CLAUDE-opus-thinking";
  const metadata = { accountId: 42, scope: "group", groupId: "中文组", groupName: "QA", routes: { [id]: "openai" } };
  const group = { id: metadata.groupId, models: [{ id, supportedEndpointTypes: ["openai"] }] };
  const calls = [];
  const relay = new MirrorCodingRelay({
    snapshot: () => ({ status: "connected", account: { id: 42 }, catalog: { groups: [group] } }),
    request: async (path, init) => {
      calls.push({ path, headers: new Headers(init.headers), body: JSON.parse(init.body.toString()) });
      return new Response("upstream rejects messages", { status: 403 });
    },
  });
  try {
    const binding = await relay.bind("provider", metadata, id, "session");
    assert.equal(binding.api, "anthropic-messages");
    const payload = { model: id, max_tokens: 8192, thinking: { type: "adaptive" }, output_config: { effort: "max" } };
    const send = (path) => fetch(binding.baseUrl + path, { method: "POST", headers: { ...binding.headers, "content-type": "application/json", "x-api-key": binding.apiKey }, body: JSON.stringify(payload) });
    assert.equal((await send("/v1/messages")).status, 403);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/v1/messages");
    assert.deepEqual(calls[0].body, payload);
    assert.equal(calls[0].headers.get("x-mirrorcoding-group"), encodeURIComponent(metadata.groupId));
    assert.equal(calls[0].headers.get("x-api-key"), null);
    assert.equal((await send("/v1/chat/completions")).status, 403);
    group.models = [];
    assert.equal((await send("/v1/messages")).status, 403);
    assert.equal(calls.length, 1, "no fallback and no request after removal from group");
  } finally { relay.dispose(); }
});
