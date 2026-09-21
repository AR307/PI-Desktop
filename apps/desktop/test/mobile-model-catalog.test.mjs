import assert from "node:assert/strict";
import test from "node:test";

const { buildMobileModelCatalog } = await import("../electron/main/mobile-sync/catalog.ts");

const binding = (id, thinkingLevels = ["off", "medium"]) => ({
  id,
  contextWindow: 128_000,
  maxTokens: 8_192,
  thinkingLevels,
  defaultThinkingLevel: thinkingLevels.at(-1) ?? "off",
});

function provider(overrides = {}) {
  return {
    id: "provider-a",
    name: "MirrorCoding / OpenAI",
    vendorKey: "mirrorcoding",
    type: "custom",
    protocol: "openai",
    enabled: true,
    authKind: "mirrorcoding",
    // Managed credentials stay in Electron main, so Rust reports no provider secret.
    hasSecret: false,
    models: [binding("shared-model"), binding("image-only")],
    supportsReasoning: true,
    supportsVision: false,
    supportedThinkingLevels: ["off", "medium"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    mirrorCoding: {
      accountId: 7,
      groupId: "group-a",
      groupName: "中文 分组",
      description: "OpenAI route",
      ratio: 0.06,
      dynamicBilling: false,
      routes: { "shared-model": "openai" },
      imageModels: {
        "image-only": {
          generation_path: "/v1/images/generations",
          reference_path: "/v1/images/edits",
          sizes: ["1024x1024"],
          qualities: ["high"],
          max_count: 2,
          supports_chat: false,
        },
      },
    },
    ...overrides,
  };
}

test("mobile catalog keeps MirrorCoding groups as model variants and filters image-only chat rows", async () => {
  const result = await buildMobileModelCatalog({
    host: () => ({
      call: async (method) => {
        assert.equal(method, "providers.list");
        return { providers: [provider()] };
      },
    }),
    images: {
      models: async () => [{
        providerId: "provider-a",
        modelId: "image-only",
        displayName: "image-only",
        groupName: "中文 分组",
        description: "OpenAI route",
        ratio: 0.06,
        dynamicBilling: false,
        capability: provider().mirrorCoding.imageModels["image-only"],
      }],
    },
    isMirrorCodingReady: () => true,
  });

  assert.deepEqual(result.chat.map((choice) => choice.modelId), ["shared-model"]);
  assert.equal(result.chat[0].groupName, "中文 分组");
  assert.equal(result.chat[0].ratio, 0.06);
  assert.deepEqual(result.chat[0].supportedThinkingLevels, ["off", "medium"]);
  assert.equal(result.image.length, 1);
  assert.equal(result.image[0].modelId, "image-only");
  assert.equal(result.image[0].image.reference_path, "/v1/images/edits");
});

test("ordinary providers with the same model id remain source-distinguishable", async () => {
  const first = provider({ id: "provider-a", name: "Provider A", mirrorCoding: undefined, hasSecret: true });
  const second = provider({ id: "provider-b", name: "Provider B", mirrorCoding: undefined, hasSecret: true });
  const result = await buildMobileModelCatalog({
    host: () => ({ call: async () => ({ providers: [first, second] }) }),
    images: { models: async () => [] },
    isMirrorCodingReady: () => false,
  });

  const rows = result.chat.filter((choice) => choice.modelId === "shared-model");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((choice) => choice.providerName), ["Provider A", "Provider B"]);
});

test("ordinary providers without credential requirements remain available", async () => {
  const local = provider({ id: "provider-local", name: "Local Provider", mirrorCoding: undefined, authKind: "none" });
  const result = await buildMobileModelCatalog({
    host: () => ({ call: async () => ({ providers: [local] }) }),
    images: { models: async () => [] },
    isMirrorCodingReady: () => false,
  });

  assert.deepEqual(result.chat.map((choice) => choice.providerId), ["provider-local", "provider-local"]);
});

test("image catalog preserves service-declared group pricing and dynamic billing", async () => {
  const result = await buildMobileModelCatalog({
    host: () => ({ call: async () => ({ providers: [] }) }),
    images: {
      models: async () => [{
        providerId: "provider-auto",
        modelId: "seedream",
        displayName: "Seedream",
        groupName: "auto",
        description: "Dynamic group",
        ratio: null,
        dynamicBilling: true,
        capability: {
          generation_path: "/v1/images/generations",
          max_count: 1,
          supports_chat: false,
        },
      }],
    },
    isMirrorCodingReady: () => false,
  });

  assert.equal(result.image[0].dynamicBilling, true);
  assert.equal(result.image[0].ratio, null);
  assert.equal(result.image[0].groupName, "auto");
  assert.equal(result.image[0].groupDescription, "Dynamic group");
});

test("mobile catalog hides MirrorCoding chat routes when the current account is unavailable", async () => {
  const result = await buildMobileModelCatalog({
    host: () => ({ call: async () => ({ providers: [provider()] }) }),
    images: { models: async () => [] },
    isMirrorCodingReady: () => false,
  });

  assert.deepEqual(result.chat, []);
});

test("mobile catalog reports image-service failures instead of hiding image models", async () => {
  await assert.rejects(() => buildMobileModelCatalog({
    host: () => ({ call: async () => ({ providers: [] }) }),
    images: { models: async () => { throw new Error("image catalog unavailable"); } },
    isMirrorCodingReady: () => false,
  }), /image catalog unavailable/);
});
