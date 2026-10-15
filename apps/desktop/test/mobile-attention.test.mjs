import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { MOBILE_ATTENTION_TEXT_LIMIT } from "@pi-desktop/shared";

const vite = await createViteServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { signalForEvent, signalForImage, boundedText, plainText } = await vite.ssrLoadModule("/electron/main/mobile-sync/activity.ts");
const { MobileActivityBroadcaster } = await vite.ssrLoadModule("/electron/main/mobile-sync/activity-broadcaster.ts");
test.after(() => vite.close());

const at = "2026-10-14T10:00:00.000Z";
function envelope(kind, payload, extra = {}) {
  return { eventId: `e-${kind}`, scope: "session", sessionId: "s1", turnId: "t1", epoch: "ep", revision: 1, kind, occurredAt: at, payload, ...extra };
}
const idle = { pending: () => ({ approvals: 0, inputs: 0 }), turnError: () => undefined };

test("approval and question requests become needs-action attention with bounded titles", () => {
  const long = "Run `npm test` ".repeat(40);
  const approval = signalForEvent(envelope("approval.requested", { id: "a1", sessionId: "s1", turnId: "t1", kind: "tool", summary: long, allowedDecisions: ["allow-once", "deny"] }), idle);
  assert.equal(approval.attention.kind, "approval");
  assert.equal(approval.attention.id, "approval:a1");
  assert.equal(approval.attention.requestId, "a1");
  assert.ok(approval.attention.title.length <= MOBILE_ATTENTION_TEXT_LIMIT);
  assert.ok(approval.attention.title.endsWith("…"));
  const input = signalForEvent(envelope("input.requested", { id: "i1", sessionId: "s1", turnId: "t1", questions: [{ id: "q", question: "Which color?", options: ["red"], multiSelect: false }] }), idle);
  assert.deepEqual([input.attention.kind, input.attention.title, input.attention.id], ["input", "Which color?", "input:i1"]);
});

test("top-level turn outcomes notify; delegates and pending requests do not end the parent", () => {
  const completed = signalForEvent(envelope("turn.completed", {}), idle);
  assert.equal(completed.attention.kind, "completed");
  assert.equal(completed.attention.id, "turn:t1:completed");
  assert.equal(signalForEvent(envelope("turn.completed", {}, { parentToolCallId: "task-1" }), idle), undefined);
  const waiting = signalForEvent(envelope("turn.completed", {}), { ...idle, pending: () => ({ approvals: 1, inputs: 0 }) });
  assert.deepEqual(waiting, { sessionId: "s1" });
  const failed = signalForEvent(envelope("turn.failed", { event: { type: "error", error: { code: "PROVIDER_ERROR", message: "Upstream\n  returned 500" } } }), idle);
  assert.deepEqual([failed.attention.kind, failed.attention.errorCode, failed.attention.preview], ["failed", "PROVIDER_ERROR", "Upstream returned 500"]);
  const settled = signalForEvent(envelope("turn.failed", {}), { ...idle, turnError: () => ({ code: "HOST_DISCONNECTED", message: "Sidecar exited" }) });
  assert.equal(settled.attention.errorCode, "HOST_DISCONNECTED");
});

test("resolution clears attention only when nothing else is pending; status-only events refresh the row", () => {
  assert.equal(signalForEvent(envelope("approval.resolved", {}), idle).attention.kind, "resolved");
  assert.deepEqual(signalForEvent(envelope("input.resolved", {}), { ...idle, pending: () => ({ approvals: 0, inputs: 1 }) }), { sessionId: "s1" });
  assert.deepEqual(signalForEvent(envelope("turn.started", {}), idle), { sessionId: "s1" });
  assert.equal(signalForEvent(envelope("item.delta", {}), idle), undefined);
  assert.equal(signalForEvent({ ...envelope("session.changed", {}), scope: "host" }, idle), undefined);
});

test("direct image jobs report completion and failure once", () => {
  assert.equal(signalForImage({ sessionId: "s1", jobId: "j1", status: "running" }, undefined, at).attention, undefined);
  assert.equal(signalForImage({ sessionId: "s1", jobId: "j1", status: "complete" }, "running", at).attention.id, "image:j1:completed");
  assert.equal(signalForImage({ sessionId: "s1", jobId: "j1", status: "complete" }, "complete", at), undefined);
  const failed = signalForImage({ sessionId: "s1", jobId: "j2", status: "error", error: "quota" }, "running", at);
  assert.deepEqual([failed.attention.kind, failed.attention.image, failed.attention.preview], ["failed", true, "quota"]);
  assert.equal(boundedText("   "), undefined);
});

test("notification previews read as plain text without mangling identifiers", () => {
  assert.equal(plainText("## Done\n- All **tests** pass in `pnpm test`\n- See [report](https://example.com)"), "Done\nAll tests pass in pnpm test\nSee report");
  assert.equal(plainText("Renamed my_var_name and kept 2*3*4"), "Renamed my_var_name and kept 2*3*4");
  assert.equal(plainText("Before\n```ts\nconst x = 1;\n```\nafter _it_ works"), "Before\n \nafter it works");
});

function broadcaster({ targets = [], messages = [] } = {}) {
  const calls = [];
  let imageListener;
  const host = { call: async (method, params) => {
    calls.push(method);
    if (method === "session.get") return { session: { id: params.id, title: "Fix layout", mode: "agent", permissionMode: "ask", source: "desktop", createdAt: at, updatedAt: at, messages } };
    if (method === "settings.get") return {};
    if (method === "providers.get") return {};
    throw new Error(`unexpected ${method}`);
  } };
  const agent = {
    pendingApprovals: () => [], pendingInputRequests: () => [], getTurn: () => ({}),
    describeSession: (summary) => ({ id: summary.id, title: summary.title, status: "idle", planningState: "inactive", queuedTurnIds: [], permissionMode: "ask", revision: 1, createdAt: at, updatedAt: at }),
  };
  const logged = [];
  const instance = new MobileActivityBroadcaster({
    host: () => host, agent: () => agent, delayMs: 0, targets: () => targets, log: (message, error) => logged.push([message, String(error)]),
    images: { states: () => [], subscribe: (listener) => { imageListener = listener; return () => { imageListener = undefined; }; } },
  });
  return { instance, calls, logged, image: (state) => imageListener?.(state) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("bursts coalesce into one projection that still delivers every attention in order", async () => {
  const received = [];
  const target = { activity: async (sessionId, session, attention) => { received.push([sessionId, session.title, attention?.kind]); } };
  const { instance, calls, logged } = broadcaster({ targets: [target], messages: [{ id: "m1", role: "assistant", content: "All tests pass.", createdAt: at }] });
  instance.agentEvent(envelope("turn.started", {}));
  instance.agentEvent(envelope("approval.requested", { id: "a1", sessionId: "s1", turnId: "t1", kind: "tool", summary: "Run tests", allowedDecisions: ["allow-once"] }));
  instance.agentEvent(envelope("approval.resolved", {}));
  instance.agentEvent(envelope("turn.completed", {}));
  await settle();
  assert.deepEqual(logged, []);
  assert.deepEqual(received.map(([, , kind]) => kind), ["approval", "resolved", "completed"]);
  assert.equal(calls.filter((method) => method === "session.get").length, 1);
  instance.dispose();
});

test("completion carries the final reply preview; image outcomes and idle peers are handled", async () => {
  const delivered = [];
  const { instance, image } = broadcaster({ targets: [{ activity: async (_id, _session, attention) => { delivered.push(attention); } }], messages: [{ id: "m1", role: "assistant", content: "Done:\n\nall green", createdAt: at }] });
  instance.agentEvent(envelope("turn.completed", {}));
  await settle();
  assert.equal(delivered[0].preview, "Done: all green");
  image({ sessionId: "s1", jobId: "j1", status: "running" });
  image({ sessionId: "s1", jobId: "j1", status: "complete" });
  await settle();
  assert.equal(delivered.at(-1).id, "image:j1:completed");
  instance.dispose();
  const quiet = broadcaster();
  quiet.instance.agentEvent(envelope("turn.completed", {}));
  await settle();
  assert.deepEqual(quiet.calls, [], "no host reads while no phone asked for activity");
  quiet.instance.dispose();
});
