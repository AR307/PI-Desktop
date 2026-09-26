import assert from "node:assert/strict";
import test from "node:test";
import {
  inheritedSessionModelBinding,
  lastUsedSessionModel,
  newConversationModelBinding,
  pinnedSessionModelBinding,
  recentConversationModel,
  sessionNeedsModelPin,
} from "../src/lib/session-model.ts";

const providers = [
  {
    id: "openai",
    defaultModelId: "gpt-4.1",
    models: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
  },
  {
    id: "anthropic",
    defaultModelId: "claude-sonnet",
    models: [{ id: "claude-sonnet" }],
  },
];

test("a new conversation prefers the last in-scope session model", () => {
  assert.deepEqual(
    newConversationModelBinding({
      draft: null,
      latestSession: { providerId: "anthropic", modelId: "claude-sonnet" },
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(
    newConversationModelBinding({
      draft: { providerId: "openai", modelId: "gpt-4.1-mini" },
      latestSession: { providerId: "anthropic", modelId: "claude-sonnet" },
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
  assert.deepEqual(
    newConversationModelBinding({
      draft: null,
      latestSession: null,
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
  assert.deepEqual(
    recentConversationModel({
      providerId: "anthropic",
      modelId: "claude-sonnet",
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(recentConversationModel(null), {});
  assert.deepEqual(
    inheritedSessionModelBinding({
      draft: recentConversationModel({
        providerId: "anthropic",
        modelId: "claude-sonnet",
      }),
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(
    inheritedSessionModelBinding({
      draft: recentConversationModel(null),
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
});

test("new sessions snapshot the app default provider and model", () => {
  assert.deepEqual(
    inheritedSessionModelBinding({
      draft: null,
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
});

test("an explicit composer draft wins over the app default", () => {
  assert.deepEqual(
    inheritedSessionModelBinding({
      draft: { providerId: "anthropic", modelId: "claude-sonnet" },
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
});

test("changing the app default later does not rewrite a pinned session", () => {
  const created = inheritedSessionModelBinding({
    draft: null,
    settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1" },
    providers,
  });
  const laterDefault = inheritedSessionModelBinding({
    draft: null,
    settings: { defaultProviderId: "anthropic", defaultModelId: "claude-sonnet" },
    providers,
  });
  assert.deepEqual(created, { providerId: "openai", modelId: "gpt-4.1" });
  assert.deepEqual(laterDefault, { providerId: "anthropic", modelId: "claude-sonnet" });
  assert.notDeepEqual(created, laterDefault);
});

test("unpinned desktop sessions need a durable model pin", () => {
  assert.equal(sessionNeedsModelPin({}), true);
  assert.equal(sessionNeedsModelPin({ providerId: "openai" }), true);
  assert.equal(sessionNeedsModelPin({ modelId: "gpt-4.1" }), true);
  assert.equal(
    sessionNeedsModelPin({ providerId: "openai", modelId: "gpt-4.1" }),
    false,
  );
  assert.equal(
    sessionNeedsModelPin({ source: "pi-native", providerId: "openai" }),
    false,
  );
  assert.equal(
    sessionNeedsModelPin({ source: "remote", modelId: "gpt-4.1" }),
    false,
  );
});

test("legacy unpinned sessions pin the last used turn before the live default", () => {
  assert.deepEqual(
    lastUsedSessionModel([
      { providerId: "openai", modelId: "gpt-4.1" },
      { providerId: "anthropic", modelId: "claude-sonnet" },
    ]),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(
    pinnedSessionModelBinding({
      session: {},
      messages: [{ providerId: "anthropic", modelId: "claude-sonnet" }],
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(
    pinnedSessionModelBinding({
      session: {},
      messages: [],
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
});
