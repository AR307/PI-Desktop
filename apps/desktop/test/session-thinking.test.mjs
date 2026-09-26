import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import {
  applyOptimisticSessionConfiguration,
  providerThinkingLevels,
  resolveComposerThinkingProvider,
} from "../src/lib/session-thinking.ts";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { thinkingProviderForModel } = await import("../src/features/chat/composer/model.ts");

const reasoningProvider = {
  id: "bigmodel",
  supportsReasoning: true,
  supportedThinkingLevels: ["low", "high", "max"],
};

const catalogThinkingProvider = {
  ...reasoningProvider,
};

test("a stored binding drives the draft thinking menu without a live catalog", () => {
  // MirrorCoding rows never publish a /models endpoint, so the composer has no
  // live catalog for them. The provider-level flag reflects the row's default
  // model; a group whose default is non-reasoning must not lock the menu for
  // its other, reasoning-capable models (fresh-profile draft regression).
  const provider = {
    id: "mc-group",
    supportsReasoning: false,
    supportedThinkingLevels: ["off"],
    models: [
      { id: "codex-auto-review", thinkingLevels: [] },
      { id: "gpt-5.4", thinkingLevels: ["off", "low", "medium", "high", "xhigh"] },
    ],
  };
  const picked = thinkingProviderForModel(provider, "gpt-5.4", undefined);
  assert.equal(picked?.supportsReasoning, true);
  assert.deepEqual(providerThinkingLevels(picked), ["off", "low", "medium", "high", "xhigh"]);
  // A binding whose levels exclude reasoning stays locked.
  const nonReasoning = thinkingProviderForModel(provider, "codex-auto-review", undefined);
  assert.equal(nonReasoning?.supportsReasoning, false);
  assert.deepEqual(providerThinkingLevels(nonReasoning), []);
  // No catalog and no binding: the provider passes through unchanged.
  assert.equal(thinkingProviderForModel(provider, "unknown-model", undefined), provider);
  // A live catalog entry still wins for capability metadata when present.
  const catalogued = thinkingProviderForModel(
    { ...provider, models: [] },
    "gpt-5.4",
    [{ modelId: "gpt-5.4", reasoning: true, capabilities: ["reasoning"], supportedThinkingLevels: ["low", "high"] }],
  );
  assert.equal(catalogued?.supportsReasoning, true);
  assert.deepEqual(providerThinkingLevels(catalogued), ["low", "high"]);
});

test("unpinned degraded session caps stay on the catalog thinking menu", () => {
  const thinkingProvider = resolveComposerThinkingProvider({
    provider: reasoningProvider,
    modelId: "glm-5.3-flash",
    activeSession: {
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    },
    catalogThinkingProvider,
  });
  assert.equal(thinkingProvider?.supportsReasoning, true);
  assert.deepEqual(providerThinkingLevels(thinkingProvider), ["low", "high", "max"]);
});

test("optimistic pin of an unpinned session drops stale capability fields", () => {
  const pinned = applyOptimisticSessionConfiguration(
    {
      supportsReasoning: false,
      supportsVision: false,
      supportedThinkingLevels: ["off"],
    },
    {
      providerId: "bigmodel",
      modelId: "glm-5.3-flash",
      thinkingLevel: "high",
    },
  );
  assert.equal(pinned.providerId, "bigmodel");
  assert.equal(pinned.modelId, "glm-5.3-flash");
  assert.equal(pinned.thinkingLevel, "high");
  assert.equal(pinned.supportsReasoning, undefined);
  assert.equal(pinned.supportsVision, undefined);
  assert.equal(pinned.supportedThinkingLevels, undefined);

  const thinkingProvider = resolveComposerThinkingProvider({
    provider: reasoningProvider,
    modelId: "glm-5.3-flash",
    activeSession: pinned,
    catalogThinkingProvider,
  });
  assert.equal(thinkingProvider?.supportsReasoning, true);
  assert.deepEqual(providerThinkingLevels(thinkingProvider), ["low", "high", "max"]);
});

test("empty session thinking levels fall back to the catalog instead of Off-only", () => {
  const thinkingProvider = resolveComposerThinkingProvider({
    provider: reasoningProvider,
    modelId: "glm-5.3-flash",
    activeSession: {
      providerId: "bigmodel",
      modelId: "glm-5.3-flash",
      supportsReasoning: true,
      supportedThinkingLevels: [],
    },
    catalogThinkingProvider,
  });
  assert.deepEqual(providerThinkingLevels(thinkingProvider), ["low", "high", "max"]);
});

test("usable session capabilities still win over the catalog", () => {
  const thinkingProvider = resolveComposerThinkingProvider({
    provider: reasoningProvider,
    modelId: "glm-5.3-flash",
    activeSession: {
      providerId: "bigmodel",
      modelId: "glm-5.3-flash",
      supportsReasoning: true,
      supportedThinkingLevels: ["high", "max"],
    },
    catalogThinkingProvider,
  });
  assert.deepEqual(providerThinkingLevels(thinkingProvider), ["high", "max"]);
});

test("changing only the thinking level keeps pinned session capabilities", () => {
  const next = applyOptimisticSessionConfiguration(
    {
      providerId: "bigmodel",
      modelId: "glm-5.3-flash",
      supportsReasoning: true,
      supportedThinkingLevels: ["low", "high", "max"],
    },
    { thinkingLevel: "low", providerId: "bigmodel", modelId: "glm-5.3-flash" },
  );
  assert.equal(next.supportsReasoning, true);
  assert.deepEqual(next.supportedThinkingLevels, ["low", "high", "max"]);
});
