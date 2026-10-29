import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const scratch = join(root, "apps/desktop/.artifacts");
await mkdir(scratch, { recursive: true });
const temp = await mkdtemp(join(scratch, "gemini-relay-"));
const home = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = temp;
process.env.USERPROFILE = temp;
after(() => {
  for (const [key, value] of Object.entries(home)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const bundle = join(temp, "fixture.mjs");
await build({
  stdin: {
    contents: [
      'export { createSessionLaunchRuntime } from "./apps/desktop/electron/main/runtime/session-launch.ts";',
      'export { MirrorCodingRelay } from "./apps/desktop/electron/main/mirrorcoding/relay.ts";',
      'export { compileCatalog } from "./apps/desktop/electron/main/mirrorcoding/catalog.ts";',
      'export { buildProviderModel, createProviderModels } from "./packages/agent-runtime/src/provider-binding.ts";',
      'export { genericModelConfig } from "./packages/agent-runtime/src/model-capabilities.ts";',
      'export { AgentSidecar, HostProcess } from "@pi-desktop/host-runtime";',
    ].join("\n"),
    resolveDir: root,
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  nodePaths: [join(root, "apps/desktop/node_modules")],
});
const {
  createSessionLaunchRuntime, MirrorCodingRelay, compileCatalog,
  buildProviderModel, createProviderModels, genericModelConfig,
  AgentSidecar, HostProcess,
} = await import(pathToFileURL(bundle).href);

function fixture(headers, replyParts = () => [{ text: "Local Gemini reply" }]) {
  const id = "gemini-3.8-flash";
  const group = {
    id: "测试组", name: "QA", description: "", ratio: 1, dynamicBilling: false,
    models: [{ id, modes: ["text"], supportedEndpointTypes: ["gemini"] }],
  };
  const catalog = {
    user: { id: 42, displayName: "QA" }, groups: [group],
    supportedEndpoints: { gemini: { method: "POST", path: "/v1beta/models/{model}:generateContent" } },
  };
  const metadata = compileCatalog(catalog, { findModel: () => undefined }).groups[0].metadata;
  const calls = [];
  const relay = new MirrorCodingRelay({
    snapshot: () => ({ status: "connected", account: { id: 42 }, catalog }),
    groupUnavailable: async () => {},
    request: async (route, init) => {
      calls.push({ route, headers: new Headers(init.headers), body: JSON.parse(init.body.toString()) });
      const chunk = {
        candidates: [{ content: { role: "model", parts: replyParts(calls.length) }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
      };
      return new Response("data: " + JSON.stringify(chunk) + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  const provider = {
    id: "fixture-mirrorcoding", name: "MirrorCoding", vendorKey: "mirrorcoding",
    authKind: "mirrorcoding", enabled: true, defaultModelId: id, models: [],
    mirrorCoding: metadata, ...(headers ? { headers } : {}),
  };
  const bindingFor = async (providerId, modelId, sessionId) => {
    const binding = await relay.bind(providerId, metadata, modelId, sessionId);
    return {
      ...binding, id: providerId, name: provider.name, modelId, authKind: "mirrorcoding",
      supportsReasoning: false, supportedThinkingLevels: ["off"],
      modelConfig: { ...genericModelConfig(modelId, binding.baseUrl), api: binding.api },
    };
  };
  const host = {
    isAvailable: () => true,
    async call(method) {
      if (method === "commandShells.list") {
        const shell = { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true };
        return { configuredId: "bash", effective: shell, fallback: false, choices: [shell] };
      }
      if (method === "providers.list") return { providers: [provider] };
      if (method === "skills.disabledBuiltins" || method === "agents.disabledBuiltins") return { disabled: [] };
      if (method === "skills.active") return { skills: [] };
      if (method === "mcp.active") return { servers: [] };
      if (method === "agents.active") return { subagents: [] };
      throw new Error("Unexpected fixture Host method: " + method);
    },
  };
  const runtime = createSessionLaunchRuntime({
    runtimeState: { host, sidecar: { setVendorAuthBindings() {} }, agentHostBridge: null },
    logger: { app() {} },
    userMcp: { setRecords() {}, async toolsForProject() { return []; } },
    plugins: { getTools: () => [], getSkills: () => [], listLoaded: () => [], getAgentExtensions: () => [] },
    sessionProjects: new Map(), dataDir: temp,
    vendorOAuth: { async bindingFor() { return undefined; } },
    modelsDevCatalog: { async ensureLoaded() {}, configureAccount() {}, findModel() {} },
    getWorkspacePath: () => null, pluginActiveInProject: () => true,
    bindingForModel: () => undefined,
    effectiveSubagentModelConfig: () => ({ modelConfig: undefined, capabilities: {} }),
    normalizeThinkingLevel: () => "off", mirrorCodingBindingFor: bindingFor,
  });
  const launch = (sessionId = "gemini-session") => runtime.resolveAgentRuntimeLaunch(
    sessionId, { providerId: provider.id, modelId: id },
    { defaultProviderId: provider.id, defaultModelId: id, defaultMode: "chat" },
  );
  return { relay, calls, launch, bindingFor, provider, group };
}

for (const customHeaders of [undefined, { "x-fixture-header": "kept", "X-Pi-Mirrorcoding-Key": "stale-fixture-key" }]) {
  test("Gemini session launch carries its binding through the real SDK" + (customHeaders ? " over stored headers" : ""), async () => {
    const f = fixture(customHeaders);
    try {
      const { sidecarParams } = await f.launch();
      const provider = JSON.parse(JSON.stringify(sidecarParams.provider));
      const model = buildProviderModel(provider);
      const models = createProviderModels(provider, model);
      const first = { role: "user", content: [{ type: "text", text: "Reply to this local fixture." }], timestamp: 1 };
      const response = await models.streamSimple(model, { messages: [first] }, { maxTokens: 64 }).result();
      assert.equal(response.stopReason, "stop", response.errorMessage);
      assert.equal(response.content[0]?.text, "Local Gemini reply");
      assert.equal(provider.headers["x-pi-mirrorcoding-key"], provider.apiKey);
      assert.equal("x-pi-mirrorcoding-key" in provider, false, "headers must not become provider fields");
      if (customHeaders) assert.equal(provider.headers["x-fixture-header"], "kept");
      const second = await models.streamSimple(model, {
        messages: [first, response, { role: "user", content: [{ type: "text", text: "Continue the same conversation." }], timestamp: 2 }],
      }, { maxTokens: 64 }).result();
      assert.equal(second.stopReason, "stop", second.errorMessage);
      assert.equal(f.calls.length, 2);
      assert.deepEqual(f.calls[1].body.contents.map(entry => entry.role), ["user", "model", "user"]);
      for (const call of f.calls) {
        assert.equal(call.route, "/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
        assert.equal(call.headers.get("x-mirrorcoding-group"), encodeURIComponent(f.group.id));
        for (const name of ["authorization", "x-goog-api-key", "x-pi-mirrorcoding-key", "x-api-key", "x-fixture-header"]) {
          assert.equal(call.headers.get(name), null, name + " must not reach the upstream account boundary");
        }
      }
      f.relay.invalidate();
      const stale = await models.streamSimple(model, { messages: [first] }, { maxTokens: 64 }).result();
      assert.equal(stale.stopReason, "error");
      assert.match(stale.errorMessage, /relay_binding_missing/);
      assert.equal(f.calls.length, 2, "invalidated credentials never reach upstream");
      const rebound = (await f.launch()).sidecarParams.provider;
      assert.notEqual(rebound.apiKey, provider.apiKey);
      const reboundModel = buildProviderModel(rebound);
      const recovered = await createProviderModels(rebound, reboundModel).streamSimple(reboundModel, { messages: [first] }, { maxTokens: 64 }).result();
      assert.equal(recovered.stopReason, "stop", recovered.errorMessage);
    } finally { f.relay.dispose(); }
  });
}

test("Gemini native API-key carrier validates the existing binding without forwarding credentials", async () => {
  const f = fixture();
  try {
    const binding = await f.bindingFor(f.provider.id, f.provider.defaultModelId, "native-key-session");
    const model = buildProviderModel({ ...binding, headers: undefined });
    const result = await createProviderModels(binding, model).streamSimple(model, {
      messages: [{ role: "user", content: [{ type: "text", text: "Native Google header fixture." }], timestamp: 1 }],
    }, { maxTokens: 64 }).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].headers.get("x-goog-api-key"), null);
    for (const headers of [{}, { "x-goog-api-key": "wrong-key" }, { "x-pi-mirrorcoding-key": "wrong-key", "x-goog-api-key": binding.apiKey }]) {
      const response = await fetch(binding.baseUrl + "/models/gemini-3.8-flash:generateContent", {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "relay_binding_missing");
    }
    assert.equal(f.calls.length, 1);
  } finally { f.relay.dispose(); }
});

test("Gemini Agent reads a file and continues through the native Host and Sidecar", {
  timeout: 90_000,
  skip: process.env.PI_DESKTOP_HOST_BIN ? false : "Set PI_DESKTOP_HOST_BIN for native process acceptance",
}, async () => {
  const workspace = join(temp, "workspace");
  await mkdir(workspace, { recursive: true });
  const fixtureFile = join(workspace, "fixture.txt");
  await writeFile(fixtureFile, "GEMINI_RELAY_READ_FIXTURE\n");
  const f = fixture(undefined, count => count === 1
    ? [{ functionCall: { name: "Read", args: { path: fixtureFile } } }]
    : [{ text: "Local Gemini reply" }]);
  const runtimeScratch = join(root, "packages/agent-runtime/.artifacts");
  await mkdir(runtimeScratch, { recursive: true });
  const runtimeTemp = await mkdtemp(join(runtimeScratch, "gemini-sidecar-"));
  const sidecarFile = join(runtimeTemp, "sidecar.mjs");
  await build({
    entryPoints: [join(root, "packages/agent-runtime/src/sidecar.ts")],
    outfile: sidecarFile, bundle: true, platform: "node", format: "esm", packages: "external",
  });
  const host = new HostProcess({ binaryPath: process.env.PI_DESKTOP_HOST_BIN, dataDir: join(temp, "host"), onStderr() {} });
  const sidecar = new AgentSidecar({
    launch: { command: process.execPath, args: [sidecarFile], cwd: runtimeTemp,
      env: { ...process.env, HOME: runtimeTemp, USERPROFILE: runtimeTemp } },
    onStderr: text => process.stderr.write(text),
  });
  sidecar.setHost(host);
  const events = [];
  const unsubscribe = sidecar.onNotification((method, params) => {
    if (method === "agent.event") events.push(params);
  });
  try {
    await host.call("app.handshake", { protocolVersion: 11 });
    const { session } = await host.call("session.create", { title: "Local Gemini relay acceptance", mode: "agent", projectPath: workspace });
    const { sidecarParams } = await f.launch(session.id);
    sidecarParams.mode = "agent";
    sidecarParams.projectPath = workspace;
    sidecarParams.commandShell = (await host.call("commandShells.list")).effective;
    for (const content of ["Reply to this fixture.", "Continue this fixture conversation."]) {
      const { turnId } = await host.call("session.beginTurn", { sessionId: session.id });
      let off;
      let timeout;
      const done = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Gemini Sidecar turn did not complete")), 30_000);
        off = sidecar.onNotification((method, params) => {
          if (method !== "agent.event" || params.sessionId !== session.id || params.turnId !== turnId) return;
          if (params.event.type === "error") reject(new Error(JSON.stringify(params.event.error)));
          if (params.event.type === "agent_end" || params.event.type === "done") resolve();
        });
      });
      try {
        const accepted = await sidecar.call("agent.prompt", { ...sidecarParams, sessionId: session.id, turnId, content });
        assert.equal(accepted.accepted, true);
        await done;
        await host.call("session.endTurn", { sessionId: session.id, turnId });
      } finally { clearTimeout(timeout); off(); }
    }
    assert.equal(f.calls.length, 3, "one tool continuation and one user continuation");
    assert.ok(JSON.stringify(f.calls[1].body.contents).includes("GEMINI_RELAY_READ_FIXTURE"));
    assert.ok(JSON.stringify(f.calls[2].body.contents).includes("Local Gemini reply"));
    assert.ok(JSON.stringify(f.calls[2].body.contents).includes("Continue this fixture conversation."));
    assert.ok(events.some(entry => JSON.stringify(entry.event).includes("Local Gemini reply")));
    assert.equal(events.some(entry => entry.event.type === "error"), false);
    await writeFile(join(temp, "native-acceptance.json"), JSON.stringify({
      model: f.provider.defaultModelId, requests: f.calls.length,
      eventTypes: [...new Set(events.map(entry => entry.event.type))],
      result: "passed", dataDirectory: join(temp, "host"),
    }, null, 2));
  } finally {
    unsubscribe();
    await sidecar.dispose();
    await host.dispose();
    f.relay.dispose();
  }
});
