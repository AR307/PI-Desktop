import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { composerClaudeCacheTarget: target } = await import("../src/features/chat/composer/claude-cache-target.ts");

const model = "claude-sonnet-4-6";
const provider = (changes = {}) => ({
  id: "api", enabled: true, apiStyle: "anthropic_messages",
  models: [{ id: model, thinkingLevels: ["off"], claudeCacheTtl: "1h" }],
  ...changes,
});

test("the selected Claude binding is editable even with reasoning off", () => {
  const p = provider();
  assert.equal(target([p], p.id, model).binding, p.models[0]);
  assert.equal(target([p], p.id, model).binding.claudeCacheTtl, "1h");
  assert.equal(target([p], p.id, "claude-sonnet-4-6-other"), undefined);
});

test("cache controls exclude other models, protocols, disabled and plugin providers", () => {
  for (const p of [
    provider({ models: [{ id: "gpt-5" }] }),
    provider({ apiStyle: "responses" }),
    provider({ models: [{ id: model, apiStyle: "chat_completions" }] }),
    provider({ enabled: false }),
    provider({ ownerPluginId: "plugin" }),
  ]) assert.equal(target([p], p.id, p.models[0].id), undefined);
  assert.equal(target([], "missing", model), undefined);
  assert.equal(target([provider()], "api", undefined), undefined);
});

test("exact model metadata and binding protocol determine support", () => {
  const p = provider({ apiStyle: "responses", models: [{ id: "alias", apiStyle: "anthropic_messages" }] });
  assert.equal(target([p], p.id, "alias"), undefined);
  assert.equal(target([p], p.id, "alias", "claude").binding.id, "alias");
});

test("MirrorCoding group selections update the matching account owner only", () => {
  const account = provider({ id: "account", mirrorCoding: { scope: "account", accountId: 901 } });
  const group = provider({ id: "group", apiStyle: "auto", models: [{ id: model, claudeCacheTtl: "5m" }],
    mirrorCoding: { scope: "group", accountId: 901, routes: { [model]: "anthropic" } } });
  const other = provider({ id: "other", mirrorCoding: { scope: "account", accountId: 902 } });
  const result = target([other, group, account], group.id, model);
  assert.equal(result.provider, account);
  assert.equal(result.binding.claudeCacheTtl, "1h");
  assert.equal(target([other, group], group.id, model), undefined);
  group.mirrorCoding.routes[model] = "responses";
  assert.equal(target([account, group], group.id, model), undefined);
});
