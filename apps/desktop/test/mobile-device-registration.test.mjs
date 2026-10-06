import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createServer } from "vite";

const vite = await createServer({ root: resolve(import.meta.dirname, ".."), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
const { registerMobileDevice } = await vite.ssrLoadModule("/electron/main/mobile-sync/device-registration.ts");
test.after(() => vite.close());

test("initial desktop registration, restart, grant refresh and reauthorization keep the server identity", async () => {
  let saved;
  const bodies = [];
  const credentials = { load: async (id) => saved?.accountId === id ? saved : undefined, save: async (value) => { saved = value; } };
  const request = async (path, body) => {
    assert.equal(path, "/devices/register"); bodies.push(body);
    return bodies.length === 1 ? { deviceId: "desktop-one", deviceSecret: "fixture-secret" } : { deviceId: "desktop-one" };
  };
  assert.equal(await registerMobileDevice(credentials, "account", "authorization-one", "Desktop", request), "desktop-one");
  assert.deepEqual(bodies, [{ kind: "desktop", name: "Desktop" }]);
  for (let i = 0; i < 3; i++) await registerMobileDevice(credentials, "account", "authorization-one", "Desktop", request);
  assert.equal(bodies.length, 1);
  await registerMobileDevice(credentials, "account", "authorization-two", "Desktop", request);
  assert.deepEqual(bodies[1], { kind: "desktop", name: "Desktop", deviceId: "desktop-one", deviceSecret: "fixture-secret" });
  assert.equal(saved.authorizationId, "authorization-two");
});

test("a server registration without the required secret is actionable and never invents an identity", async () => {
  await assert.rejects(registerMobileDevice({ load: async () => undefined, save: async () => assert.fail("must not persist an incomplete identity") }, "account", "authorization", "Desktop", async () => ({ deviceId: "old-device" })), /DEVICE_IDENTITY_MISSING/);
});
