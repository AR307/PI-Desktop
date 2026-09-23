import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { capabilitiesFromModelConfig, modelConfigWithBinding } from "@pi-desktop/agent-runtime";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createSessionLaunchRuntime } = await import("../electron/main/runtime/session-launch.ts");

test("launch resolves definition-only pins without granting Task.model selection (#286)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-model-launch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "reviewer.md");
  writeFileSync(path, "---\nname: private-reviewer\ndescription: Fixture reviewer\nmodel: fixture/private\nfallbackModels: [fixture/backup]\n---\nInspect the fixture.\n");
  const provider = {
    id: "fixture-provider", vendorKey: "fixture", name: "Fixture", enabled: true,
    authKind: "none", baseUrl: "http://127.0.0.1:1/v1", apiStyle: "openai-chat",
    models: [
      { id: "parent" }, { id: "private", availableForSubagents: false },
      { id: "allowed", availableForSubagents: true },
    ].map((binding) => ({ ...binding, thinkingLevels: ["off"] })),
  };
  const providers = [provider];
  const shell = { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true };
  const runtime = createSessionLaunchRuntime({
    runtimeState: { host: {
      isAvailable: () => true,
      call: async (method) => {
        if (method === "commandShells.list") return { configuredId: "bash", effective: shell, fallback: false, choices: [shell] };
        if (method === "providers.list") return { providers };
        if (method === "providers.getSecret") return {};
        if (method === "agents.active") return { subagents: [{ id: "reviewer", path }] };
        if (method === "skills.active") return { skills: [] };
        if (method === "mcp.active") return { servers: [] };
        if (method === "project.memory.get") return {};
        throw new Error(`Unexpected host call ${method}`);
      },
    } },
    logger: { app() {} }, userMcp: { setRecords() {}, toolsForProject: async () => [] },
    plugins: { listLoaded: () => [], getSkills: () => [], getTools: () => [], getAgentExtensions: () => [] },
    sessionProjects: new Map(), dataDir: root, vendorOAuth: {},
    modelsDevCatalog: { ensureLoaded: async () => {}, findModel: () => undefined },
    getWorkspacePath: () => root, pluginActiveInProject: () => true,
    bindingForModel: (row, id) => row.models.find((m) => m.id === id),
    modelsDevModelFor: () => undefined,
    effectiveSubagentModelConfig: (row, id, catalog) => {
      const modelConfig = modelConfigWithBinding(catalog, row.models.find((m) => m.id === id));
      return { modelConfig, capabilities: capabilitiesFromModelConfig(modelConfig) };
    },
    normalizeThinkingLevel: () => "off",
  });
  const launch = () => runtime.resolveAgentRuntimeLaunch("session", {
    providerId: provider.id, modelId: "parent", projectPath: root,
  }, {});
  const initial = (await launch()).sidecarParams;
  assert.ok(initial.subagentProviders["fixture/private"]);
  assert.ok(initial.subagentProviders["fixture/backup"]);
  assert.deepEqual(initial.subagents.find((d) => d.name === "private-reviewer").fallbackModels, [{ providerId: "fixture", modelId: "backup" }]);
  assert.deepEqual(initial.subagentModelKeys, ["fixture/allowed"]);
  assert.equal(initial.subagents.find((d) => d.name === "private-reviewer").model.modelId, "private");

  // A pin already in the resolved map still needs an independent opt-in.
  provider.models[1].availableForSubagents = true;
  const optedIn = (await launch()).sidecarParams;
  assert.deepEqual(optedIn.subagentModelKeys, ["fixture/private", "fixture/allowed"]);
  provider.models[1].availableForSubagents = false;
  provider.models[2].availableForSubagents = false;
  const revoked = (await launch()).sidecarParams;
  assert.ok(revoked.subagentProviders["fixture/private"]);
  assert.deepEqual(revoked.subagentModelKeys, []);

  // A second configured account sharing the vendor alias cannot lend its
  // opt-in to the first account's private pin.
  providers.push({ ...provider, id: "other-account", name: "Other", models: [
    { id: "private", availableForSubagents: true, thinkingLevels: ["off"] },
  ] });
  const collision = (await launch()).sidecarParams;
  assert.equal(collision.subagentProviders["fixture/private"].id, provider.id);
  assert.equal(collision.subagentProviders["other-account/private"].id, "other-account");
  assert.deepEqual(collision.subagentModelKeys, ["other-account/private"]);
});

test("MirrorCoding and ordinary providers can delegate in both directions with model-local limits", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-mirrorcoding-launch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mcDefinitionPath = join(root, "ordinary-worker.md");
  const ordinaryDefinitionPath = join(root, "mirrorcoding-worker.md");
  writeFileSync(
    mcDefinitionPath,
    "---\nname: ordinary-worker\ndescription: Uses the ordinary provider.\nmodel: ordinary/ordinary-model\n---\nInspect the fixture.\n",
  );
  writeFileSync(
    ordinaryDefinitionPath,
    "---\nname: mirrorcoding-worker\ndescription: Uses the MirrorCoding provider.\nmodel: mc-group/mc-model\n---\nInspect the fixture.\n",
  );

  const mcModel = {
    id: "Mc-Model",
    contextWindow: 64_000,
    maxTokens: 4_096,
    thinkingLevels: ["off", "high"],
    defaultThinkingLevel: "high",
    availableForSubagents: true,
  };
  const ordinaryModel = {
    id: "ordinary-model",
    contextWindow: 32_000,
    maxTokens: 2_048,
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
    availableForSubagents: true,
  };
  const mcProvider = {
    id: "mc-group",
    name: "MirrorCoding / OpenAI",
    vendorKey: "mirrorcoding",
    enabled: true,
    authKind: "mirrorcoding",
    models: [mcModel],
    mirrorCoding: {
      accountId: 42,
      groupId: "openai",
      groupName: "OpenAI",
      description: "",
      ratio: 1,
      dynamicBilling: false,
      routes: { "Mc-Model": "openai" },
    },
  };
  const ordinaryProvider = {
    id: "ordinary",
    name: "Ordinary",
    vendorKey: "ordinary",
    enabled: true,
    authKind: "none",
    baseUrl: "http://127.0.0.1:1/v1",
    apiStyle: "openai-chat",
    models: [ordinaryModel],
  };
  const providers = [mcProvider, ordinaryProvider];
  const mcRuntimeBinding = {
    id: mcProvider.id,
    name: mcProvider.name,
    vendorKey: "mirrorcoding",
    authKind: "mirrorcoding",
    modelId: mcModel.id,
    apiKey: "relay-key",
    baseUrl: "http://127.0.0.1:1/mc/v1",
    apiStyle: "openai",
    supportsReasoning: true,
    supportedThinkingLevels: ["off", "high"],
    modelConfig: {
      source: "generic",
      name: mcModel.id,
      baseUrl: "http://127.0.0.1:1/mc/v1",
      reasoning: true,
      modalities: { input: ["text"], output: ["text"] },
      limit: { context: 64_000, input: 64_000, output: 4_096 },
      input: ["text"],
      contextWindow: 64_000,
      maxTokens: 4_096,
      supportedThinkingLevels: ["off", "high"],
    },
  };
  const shell = { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true };
  const runtime = createSessionLaunchRuntime({
    runtimeState: {
      host: {
        isAvailable: () => true,
        call: async (method) => {
          if (method === "commandShells.list") return { configuredId: "bash", effective: shell, fallback: false, choices: [shell] };
          if (method === "providers.list") return { providers };
          if (method === "providers.getSecret") return {};
          if (method === "agents.active") return {
            subagents: [
              { id: "ordinary-worker", path: mcDefinitionPath },
              { id: "mirrorcoding-worker", path: ordinaryDefinitionPath },
            ],
          };
          if (method === "skills.active") return { skills: [] };
          if (method === "mcp.active") return { servers: [] };
          if (method === "project.memory.get") return {};
          throw new Error(`Unexpected host call ${method}`);
        },
      },
    },
    logger: { app() {} }, userMcp: { setRecords() {}, toolsForProject: async () => [] },
    plugins: { listLoaded: () => [], getSkills: () => [], getTools: () => [], getAgentExtensions: () => [] },
    sessionProjects: new Map(), dataDir: root, vendorOAuth: {},
    modelsDevCatalog: { ensureLoaded: async () => {}, findModel: () => undefined },
    getWorkspacePath: () => root, pluginActiveInProject: () => true,
    mirrorCoding: {
      isReady: () => true,
      bindingFor: async (_providerId, _modelId) => mcRuntimeBinding,
    },
    bindingForModel: (row, id) => row.models.find((m) => m.id === id),
    modelsDevModelFor: () => undefined,
    effectiveSubagentModelConfig: (row, id, catalog) => {
      const modelConfig = modelConfigWithBinding(catalog, row.models.find((m) => m.id === id));
      return { modelConfig, capabilities: capabilitiesFromModelConfig(modelConfig) };
    },
    normalizeThinkingLevel: () => "off",
  });

  const mcLaunch = await runtime.resolveAgentRuntimeLaunch(
    "mc-session",
    { providerId: mcProvider.id, modelId: "mc-model", projectPath: root },
    {},
  );
  assert.equal(mcLaunch.modelId, mcModel.id, "the main MC model uses the relay's canonical spelling");
  assert.equal(mcLaunch.sidecarParams.provider.modelId, mcModel.id);
  assert.equal(mcLaunch.sidecarParams.provider.modelConfig.contextWindow, 64_000);
  assert.equal(mcLaunch.sidecarParams.provider.modelConfig.maxTokens, 4_096);
  assert.equal(mcLaunch.sidecarParams.provider.supportedThinkingLevels.includes("high"), true);
  assert.deepEqual(mcLaunch.sidecarParams.subagentModelKeys, [
    "mc-group/Mc-Model",
    "ordinary/ordinary-model",
  ]);
  assert.equal(mcLaunch.sidecarParams.subagentProviders["mc-group/Mc-Model"].id, mcProvider.id);
  assert.equal(mcLaunch.sidecarParams.subagentProviders["ordinary/ordinary-model"].id, ordinaryProvider.id);
  assert.equal(mcLaunch.sidecarParams.subagentProviders["ordinary/ordinary-model"].modelConfig.contextWindow, 32_000);
  assert.equal(mcLaunch.sidecarParams.subagentProviders["ordinary/ordinary-model"].modelConfig.maxTokens, 2_048);

  const ordinaryLaunch = await runtime.resolveAgentRuntimeLaunch(
    "ordinary-session",
    { providerId: ordinaryProvider.id, modelId: ordinaryModel.id, projectPath: root },
    {},
  );
  assert.equal(ordinaryLaunch.sidecarParams.provider.id, ordinaryProvider.id);
  assert.equal(ordinaryLaunch.sidecarParams.subagentProviders["mc-group/Mc-Model"].id, mcProvider.id);
  assert.equal(ordinaryLaunch.sidecarParams.subagentProviders["mc-group/Mc-Model"].modelId, mcModel.id);
  assert.equal(ordinaryLaunch.sidecarParams.subagentProviders["mc-group/Mc-Model"].modelConfig.contextWindow, 64_000);
  assert.equal(ordinaryLaunch.sidecarParams.subagentProviders["mc-group/Mc-Model"].modelConfig.maxTokens, 4_096);
});
