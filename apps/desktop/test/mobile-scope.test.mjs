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
const { MobileScopeAccess } = await vite.ssrLoadModule("/electron/main/mobile-sync/scope.ts");
test.after(() => vite.close());

const groups = [{ id: "p1", name: "Work", roots: [{ path: "D:/work" }] }];
const sessions = [
  { id: "s1", title: "Work session", projectPath: "D:/work" },
  { id: "s2", title: "Ungrouped" },
];
const host = { call: async (method, params) => {
  if (method === "project.groups.list") return { groups };
  if (method === "session.list") return { sessions };
  if (method === "session.get") return { session: sessions.find((session) => session.id === params.id) };
  throw new Error(`Unexpected RPC ${method}`);
} };
const scope = new MobileScopeAccess(() => host);

test("account grant exposes all sessions, including ungrouped work", async () => {
  const account = [{ scope: { kind: "account", id: "account-1" } }];
  assert.deepEqual((await scope.sessions(account)).map((item) => item.id), ["s1", "s2"]);
  assert.equal((await scope.require("s2", account)).id, "s2");
});

test("project grant remains scoped to current project membership", async () => {
  const project = [{ scope: { kind: "project", id: "p1" } }];
  assert.deepEqual((await scope.sessions(project)).map((item) => item.id), ["s1"]);
  await assert.rejects(() => scope.require("s2", project), (error) => error?.code === "FORBIDDEN");
  await assert.rejects(() => scope.require("s1", []), (error) => error?.code === "FORBIDDEN");
});
