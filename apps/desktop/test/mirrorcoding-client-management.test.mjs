import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch {}
    }
    return next(specifier, context);
  },
});
const { parseCatalog, compileCatalog } = await import("../electron/main/mirrorcoding/catalog.ts");
hooks.deregister();
const modelsDev = { findModel: () => undefined, anthropicThinkingFor: () => undefined };
const input = () => ({ success: true, data: {
  user: { id: 42, display_name: "QA" },
  supported_endpoints: {
    openai: { method: "POST", path: "/v1/chat/completions" },
    "openai-response": { method: "POST", path: "/proxy/responses" },
  },
  groups: [{ id: "中文", name: "中文", description: "", ratio: 0.06, dynamic_billing: false,
    models: [{ id: "CLAUDE-test", modes: ["text"], supported_endpoint_types: ["openai"],
      fast: { enabled: true, supported_endpoint_types: ["openai"] } },
      { id: "video", modes: ["video"], supported_endpoint_types: ["openai"] },
      { id: "gpt-test", modes: ["text"], supported_endpoint_types: ["openai-response"] }] }],
} });

test("new catalog retains per-group modes and Fast; Claude names do not grant Messages", () => {
  const catalog = parseCatalog(input());
  assert.deepEqual(catalog.groups[0].models[0].modes, ["text"]);
  assert.deepEqual(catalog.groups[0].models[0].fast, { enabled: true, supportedEndpointTypes: ["openai"] });
  const group = compileCatalog(catalog, modelsDev).groups[0];
  assert.deepEqual(group.metadata.routes, { "CLAUDE-test": "openai", "gpt-test": "openai-response" });
  assert.equal(group.metadata.modelCapabilities["CLAUDE-test"].fast.enabled, true);
  assert.equal(group.metadata.supportedEndpoints["openai-response"].path, "/proxy/responses");
  assert.deepEqual(group.models.map(model => model.id), ["CLAUDE-test", "gpt-test"]);
});

test("a successful empty publication is empty, and group capabilities never authorize each other", () => {
  const raw = input();
  raw.data.groups.push({ ...raw.data.groups[0], id: "other", models: [{ id: "CLAUDE-test", modes: ["image"], supported_endpoint_types: ["openai"] }] });
  assert.deepEqual(compileCatalog(parseCatalog(raw), modelsDev).groups[1].models, []);
  raw.data.groups = [];
  assert.deepEqual(compileCatalog(parseCatalog(raw), modelsDev).groups, []);
});
