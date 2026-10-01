import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";

const vite = await createViteServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { registerMobileSyncIpc } = await vite.ssrLoadModule(
  "/electron/main/mobile-sync/ipc.ts",
);
const { IPC } = await import("@pi-desktop/shared");
test.after(() => vite.close());

test("mobile IPC validates scope and delegates to the main service", async () => {
  const handlers = new Map();
  const calls = [];
  const service = {
    status: () => ({ status: "offline", pairings: [], grants: [] }),
    refresh: async () => ({ status: "online", pairings: [], grants: [] }),
    createPairing: async (scope) => {
      calls.push(scope);
      return { id: "pairing-1", code: "12345678", expiresAt: "2030-01-01T00:00:00Z", scope: { kind: "session", id: scope.sessionId, label: "Session" } };
    },
    cancelPairing: async (id) => ({ status: "offline", pairings: [{ id, code: "", expiresAt: "", scope: { kind: "session", id: "s", label: "" } }], grants: [] }),
    revoke: async () => ({ status: "offline", pairings: [], grants: [] }),
  };
  registerMobileSyncIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, service);
  const pairing = await handlers.get(IPC.invoke.mobileSyncCreatePairing)({ kind: "session", sessionId: "session-1" });
  assert.equal(pairing.code, "12345678");
  assert.deepEqual(calls, [{ kind: "session", sessionId: "session-1" }]);
  await assert.rejects(
    () => handlers.get(IPC.invoke.mobileSyncCreatePairing)({ kind: "unknown" }),
    (error) => error?.code === "INVALID_ARGUMENT" && error?.message === "invalid_mobile_scope",
  );
});
