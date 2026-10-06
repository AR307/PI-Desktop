import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { MOBILE_ITEM_CONTENT_LIMIT, RACP_PROTOCOL_VERSION, TRANSCRIPT_DISPLAY_TRUNCATION_MARKER } from "@pi-desktop/shared";

const vite = await createViteServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { MobilePeer } = await vite.ssrLoadModule("/electron/main/mobile-sync/peer.ts");
test.after(() => vite.close());

const SESSION = {
  id: "s1", title: "Session", mode: "agent", permissionMode: "ask",
  providerId: "prov", modelId: "model", thinkingLevel: "off",
  createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
  messageCount: 3, source: "desktop",
};

function racpSession() {
  return {
    id: "s1", title: "Session", status: "idle", permissionMode: "ask", planningState: "inactive",
    queuedTurnIds: [], revision: 4, createdAt: SESSION.createdAt, updatedAt: SESSION.updatedAt,
  };
}

function liveState() {
  return {
    session: racpSession(), queuedTurns: [], activeItems: [], pendingApprovals: [], pendingInputs: [],
    cursor: { epoch: "ep_1", sequence: 9 }, revision: 4, generatedAt: SESSION.updatedAt,
  };
}

/** Harness: a fake Agent Host + host RPC behind one MobilePeer with captured replies. */
function buildPeer({ bigMessage = "big ".repeat(80_000), oversizedMessage, grants = [{ id: "grant-1", scope: { kind: "session", id: "s1", label: "Session" } }], sessions = [SESSION], groups = [] } = {}) {
  const fullMessage = oversizedMessage ?? { id: "m-big", role: "assistant", content: bigMessage, createdAt: SESSION.createdAt };
  const fullItem = { id: fullMessage.id, turnId: "", itemType: "message", status: "completed", createdAt: fullMessage.createdAt, content: fullMessage };
  const calls = { agent: [], host: [] };
  const agent = {
    attach: async (_principal, params) => { calls.agent.push(["attach", params]); return { attached: true }; },
    subscribe: (_principal, params) => { calls.agent.push(["subscribe", params]); return { subscriptionId: "sub-1", scope: "session", sessionId: params.sessionId, starting: { epoch: "ep_1", sequence: 10 }, replayComplete: true }; },
    unsubscribe: () => true,
    ack: () => {},
    sessionState: async (sessionId) => { calls.agent.push(["sessionState", sessionId]); return liveState(); },
    snapshot: async (sessionId, _summary, options) => { calls.agent.push(["snapshot", sessionId, options]); return { ...liveState(), items: oversizedMessage ? [fullItem] : [], hasMoreHistory: true, syncRevision: 12 }; },
    history: async (_principal, params) => { calls.agent.push(["history", params]); return { items: oversizedMessage ? [fullItem] : [], hasMore: false, revision: 4, syncRevision: 12 }; },
    describeSession: () => racpSession(),
    queueEntries: (sessionId) => { calls.agent.push(["queueEntries", sessionId]); return [{ turn: { id: "turn-q1" }, content: "queued prompt text" }]; },
    getTurn: (turnId) => ({ id: turnId, sessionId: "s1", status: "queued" }),
    prioritizeTurn: async (_principal, turnId) => { calls.agent.push(["prioritizeTurn", turnId]); return { id: turnId, sessionId: "s1", status: "queued", admission: "queue", effectivePermissionMode: "ask" }; },
    cancelTurn: async (_principal, turnId) => ({ id: turnId, sessionId: "s1", status: "canceled", admission: "queue", effectivePermissionMode: "ask" }),
    pendingApprovals: () => [],
  };
  const host = {
    call: async (method, params) => {
      calls.host.push([method, params]);
      if (method === "settings.get") return {};
      if (method === "providers.get") return {};
      if (method === "plans.pending") return { plans: [] };
      if (method === "session.syncRevision") return { syncRevision: 12 };
      if (method === "session.changes") return { sessionId: params.sessionId, afterRevision: params.afterRevision, revision: 12, hasMore: false, changes: [{ revision: 12, kind: "upsert", messageId: oversizedMessage ? fullMessage.id : "m-1", sequence: 1, message: oversizedMessage ?? { id: "m-1", role: "assistant", content: "Updated", createdAt: SESSION.createdAt } }] };
      if (method === "session.get") {
        return { session: { ...SESSION, messages: [fullMessage], compactions: [{ id: "ck-1", throughMessageId: "m-2", summary: "s", tokensBefore: 1 }] } };
      }
      throw new Error(`Unexpected host call ${method}`);
    },
  };
  const sent = [];
  const peer = new MobilePeer({
    peerId: "peer-1", deviceId: "phone-1", desktopDeviceId: "desk-1", dataDir: "/tmp",
    host: () => host, agent: () => agent,
    account: { snapshot: () => ({ status: "connected", account: { id: 1 } }) },
    images: { subscribe: () => () => {}, subscribeConfiguration: () => () => {}, states: () => [], abortSession: () => false },
    scope: { sessions: async () => sessions, groups: async () => groups, require: async () => SESSION },
    grants: () => grants,
    send: (frame) => sent.push(JSON.parse(frame)),
    close: (reason) => { throw new Error(`peer closed: ${reason}`); },
  });
  let id = 0;
  const request = async (method, params) => {
    id += 1;
    await peer.frame(JSON.stringify({ jsonrpc: "2.0", id: `r${id}`, method, params }));
    const reply = sent.find((frame) => frame.id === `r${id}`);
    assert.ok(reply, `no reply for ${method}`);
    if (reply.error) throw Object.assign(new Error(reply.error.message), { data: reply.error.data });
    return reply.result;
  };
  return { peer, request, calls, sent };
}

async function initialize(request) {
  return request("connection/initialize", { protocolVersion: RACP_PROTOCOL_VERSION, client: { name: "test", version: "0" }, bindings: ["RACP-WS"], capabilities: {} });
}

test("initialize advertises the light-state and item-content capabilities", async () => {
  const { request } = buildPeer();
  const result = await initialize(request);
  assert.equal(result.capabilities.sessionState, true);
  assert.equal(result.capabilities.itemContent, true);
});

test("attach with includeSnapshot:false returns the light state instead of a transcript page", async () => {
  const { request, calls } = buildPeer();
  await initialize(request);
  const light = await request("session/attach", { sessionId: "s1", includeSnapshot: false, role: "controller" });
  assert.ok(light.state, "light attach carries state");
  assert.equal(light.snapshot, undefined);
  assert.equal(light.state.queuedPrompts[0].content, "queued prompt text");
  assert.deepEqual(light.state.compactions, [{ id: "ck-1", throughMessageId: "m-2" }]);
  assert.ok(!calls.agent.some(([name]) => name === "snapshot"), "no snapshot built for a light attach");
  const full = await request("session/attach", { sessionId: "s1", role: "controller" });
  assert.ok(full.snapshot, "default attach still carries the snapshot");
  const snapshotCall = calls.agent.find(([name]) => name === "snapshot");
  assert.deepEqual(snapshotCall[2], { contentLimit: MOBILE_ITEM_CONTENT_LIMIT });
});

test("session/state serves live state and session/history caps per-field content", async () => {
  const { request, calls } = buildPeer();
  await initialize(request);
  const { state } = await request("session/state", { sessionId: "s1" });
  assert.equal(state.revision, 4);
  assert.equal(state.syncRevision, 12);
  assert.equal(state.items, undefined);
  const historyPage = await request("session/history", { sessionId: "s1", limit: 50 });
  assert.equal(historyPage.syncRevision, 12);
  const history = calls.agent.find(([name]) => name === "history");
  assert.equal(history[1].contentLimit, MOBILE_ITEM_CONTENT_LIMIT);
});

test("account directory includes empty projects and ungrouped sessions without subscribing to content", async () => {
  const { request, sent, calls, peer } = buildPeer({
    grants: [{ id: "account-grant", scope: { kind: "account", id: "account-1", label: "Account" } }],
    groups: [{ id: "project-empty", name: "Empty", primaryPath: "D:/empty", roots: [{ path: "D:/empty" }] }],
  });
  await initialize(request);
  const { subscriptionId } = await request("directory/subscribe", {});
  const directory = await request("directory/list", { limit: 10 });
  assert.equal(directory.projects[0].id, "project-empty");
  assert.equal(directory.sessions[0].projectId, undefined);
  assert.ok(!calls.agent.some(([method]) => method === "subscribe"));
  peer.directoryChanged();
  assert.ok(sent.some((frame) => frame.method === "mobile.directoryChanged"));
  assert.equal((await request("events/unsubscribe", { subscriptionId })).removed, true);
});

test("durable session changes map host messages to RACP items", async () => {
  const { request, calls } = buildPeer();
  await initialize(request);
  const page = await request("session/changes", { sessionId: "s1", afterRevision: 8, limit: 20 });
  assert.equal(page.revision, 12);
  assert.equal(page.changes[0].item.content.content, "Updated");
  assert.deepEqual(calls.host.find(([method]) => method === "session.changes")[1], { sessionId: "s1", afterRevision: 8, limit: 20, contentLimit: MOBILE_ITEM_CONTENT_LIMIT });
});

test("an oversized tool message advances revision with a bounded expandable projection", async () => {
  const oversizedMessage = { id: "m-big", role: "tool", content: "Tool completed", createdAt: SESSION.createdAt,
    toolName: "Search", toolCallId: "call-1", toolResult: { blocks: Array.from({ length: 40 }, () => "x".repeat(32_000)) } };
  const { request } = buildPeer({ oversizedMessage });
  await initialize(request);
  const page = await request("session/changes", { sessionId: "s1", afterRevision: 11 });
  assert.equal(page.revision, 12);
  assert.equal(page.hasMore, false);
  assert.equal(page.changes[0].item.content.toolCallId, "call-1");
  assert.ok(page.changes[0].item.content.content.endsWith(TRANSCRIPT_DISPLAY_TRUNCATION_MARKER));
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 512 * 1024);
  const history = await request("session/history", { sessionId: "s1" });
  const snapshot = await request("session/snapshot", { sessionId: "s1" });
  assert.ok(history.items[0].content.content.endsWith(TRANSCRIPT_DISPLAY_TRUNCATION_MARKER));
  assert.ok(snapshot.snapshot.items[0].content.content.endsWith(TRANSCRIPT_DISPLAY_TRUNCATION_MARKER));
  const chunks = []; let offset = 0;
  for (;;) {
    const item = await request("session/item", { sessionId: "s1", itemId: "m-big", offset });
    chunks.push(Buffer.from(item.data, "base64")); offset = item.nextOffset;
    if (item.eof) break;
  }
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), oversizedMessage);
});

test("session/item streams the full item JSON in relay-safe chunks", async () => {
  const big = "内容 big ".repeat(60_000);
  const { request } = buildPeer({ bigMessage: big });
  await initialize(request);
  const chunks = [];
  let offset = 0;
  for (;;) {
    const page = await request("session/item", { sessionId: "s1", itemId: "m-big", offset });
    chunks.push(Buffer.from(page.data, "base64"));
    assert.ok(Buffer.from(page.data, "base64").length <= 192 * 1024, "chunk stays under the relay frame budget");
    offset = page.nextOffset;
    if (page.eof) { assert.equal(page.size, offset); break; }
  }
  const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(message.id, "m-big");
  assert.equal(message.content, big);
});

test("turn/prioritize forwards send-now to the Agent Host", async () => {
  const { request, calls } = buildPeer();
  await initialize(request);
  const result = await request("turn/prioritize", { sessionId: "s1", turnId: "turn-q1" });
  assert.equal(result.turn.id, "turn-q1");
  assert.deepEqual(calls.agent.find(([name]) => name === "prioritizeTurn"), ["prioritizeTurn", "turn-q1"]);
});
