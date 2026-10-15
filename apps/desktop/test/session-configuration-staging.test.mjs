import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";

const vite = await createServer({ root: resolve(import.meta.dirname, ".."), configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
const { configureSession, captureTurnConfiguration, currentTurnConfiguration, releaseTurnConfiguration, onSessionConfigured } = await vite.ssrLoadModule("/electron/main/services/session-configuration.ts");
test.after(() => vite.close());

test("desktop and mobile save next-turn fields without changing the captured active launch", async () => {
  let saved = { id: "session", mode: "agent", providerId: "mc-group", modelId: "model-a", thinkingLevel: "medium", fast: false };
  const host = { async call(method, { id, ...input }) {
    assert.equal(method, "session.configure");
    assert.equal(id, saved.id);
    saved = { ...saved, ...input };
    return { session: saved };
  } };
  const changes = [];
  const off = onSessionConfigured(session => changes.push(session));
  try {
    captureTurnConfiguration(host, saved.id, "turn-a", saved);
    await configureSession(host, saved.id, { fast: true });
    await configureSession(host, saved.id, { thinkingLevel: "high" });
    assert.deepEqual([saved.fast, saved.thinkingLevel], [true, "high"]);
    assert.deepEqual([currentTurnConfiguration(host, saved.id).fast, currentTurnConfiguration(host, saved.id).thinkingLevel], [false, "medium"]);
    assert.equal(changes.length, 2);
    // A newly connected mobile peer reads the same main-owned launch snapshot.
    assert.equal(currentTurnConfiguration(host, saved.id).modelId, "model-a");
    captureTurnConfiguration(host, saved.id, "turn-b", saved);
    releaseTurnConfiguration(host, saved.id, "turn-a");
    assert.equal(currentTurnConfiguration(host, saved.id).fast, true);
    releaseTurnConfiguration(host, saved.id, "turn-b");
    assert.equal(currentTurnConfiguration(host, saved.id), undefined);
  } finally { off(); }
});

test("failed configuration does not publish an unconfirmed update", async () => {
  const received = [];
  const off = onSessionConfigured(value => received.push(value));
  try {
    const host = { async call() { throw new Error("PI_FAST_UNAVAILABLE"); } };
    await assert.rejects(configureSession(host, "session", { fast: true }), /PI_FAST_UNAVAILABLE/);
    assert.deepEqual(received, []);
  } finally { off(); }
});
