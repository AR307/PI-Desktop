import { createServer, request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { imageFixture } from "../images/fixture.mjs";

const { WebSocketServer, WebSocket } = createRequire(import.meta.url)("ws");

/** Controlled MC boundary for actual desktop/mobile acceptance, never production. */
export async function mobileFixture({ port = 0 } = {}) {
  const upstream = await imageFixture();
  const devices = new Map(), sessions = new Map(), refreshTokens = new Map();
  const pairings = new Map(), grants = new Map(), tickets = new Map(), desktops = new Map(), peers = new Map();
  const chats = [], chatRequests = [], calls = [], heldChats = new Set();
  const control = { relayUnavailable: false, challenge: false, dropTurnReplyOnce: false, mobileRefreshes: 0, abortedChats: 0 };
  let origin, serial = 0;
  const send = (socket, frame) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 4 * 1024 * 1024) { socket.close(1013, "RELAY_UNAVAILABLE"); return; }
    socket.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  };
  const grantList = (auth) => [...grants.values()].filter((grant) => grant.accountId === auth.accountId &&
    (auth.kind === "desktop" ? !auth.deviceId || grant.desktopDeviceId === auth.deviceId : grant.mobileDeviceId === auth.deviceId));
  const notify = (desktopId) => send(desktops.get(desktopId), { type: "grants.changed" });
  const closePeer = (peerId, reason) => {
    const peer = peers.get(peerId);
    if (!peer) return;
    peers.delete(peerId);
    send(desktops.get(peer.desktopDeviceId), { type: "peer.close", peerId, reason });
    peer.socket.close(4000, reason);
  };
  const account = (name) => name === "other" ? { id: "902", name: "Other account" } : { id: "901", name: "Mobile QA" };
  const issue = (user, deviceId) => {
    const accessToken = `test-mobile-${randomUUID()}`, refreshToken = `test-refresh-${randomUUID()}`;
    const auth = { kind: "mobile", accountId: user.id, user, deviceId };
    sessions.set(accessToken, auth); refreshTokens.set(refreshToken, auth);
    return { accessToken, refreshToken, expiresAt: new Date(Date.now() + 3600_000).toISOString(), account: user, ...(deviceId ? { deviceId } : {}) };
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const json = (data, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ success: true, data }));
    const fail = (code, status = 400) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ success: false, error: { code, message: code } }));
    if (!url.pathname.startsWith("/api/pi-mobile/") && !url.pathname.startsWith("/api/pi-sync/") && url.pathname !== "/v1/chat/completions") {
      const proxy = httpRequest(new URL(req.url, upstream.origin), { method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      proxy.on("error", () => { if (!res.headersSent) fail("UPSTREAM_FAILED", 503); else res.end(); });
      res.on("close", () => proxy.destroy()); req.pipe(proxy); return;
    }
    try {
      const raw = []; for await (const part of req) raw.push(part);
      const body = raw.length ? JSON.parse(Buffer.concat(raw).toString()) : {};
      if (url.pathname === "/v1/chat/completions") {
        chats.push(body);
        const lastUser = body.messages.findLastIndex((message) => message.role === "user");
        const turn = body.messages.slice(lastUser), prompt = JSON.stringify(turn[0]);
        chatRequests.push({ prompt, group: req.headers["x-mirrorcoding-group"] });
        const toolResults = turn.filter((message) => message.role === "tool");
        const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `mobile-chat-${chats.length}`, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(chunk({ role: "assistant" }));
        const finish = (text) => { if (!res.destroyed) { res.write(chunk({ content: text })); res.write(chunk({}, "stop")); res.end("data: [DONE]\n\n"); } };
        if (body.tools?.length && prompt.includes("mobile-slow") && !toolResults.length) {
          res.write(chunk({ content: "Working on the computer. " }));
          const held = { finish: () => finish("Mobile task completed."), res };
          heldChats.add(held); res.once("close", () => { if (heldChats.delete(held)) control.abortedChats++; }); return;
        }
        let tool, args;
        if (!toolResults.length && prompt.includes("mobile-question")) {
          tool = body.tools?.find((item) => /asktool/i.test(item.function.name))?.function.name;
          args = { questions: [{ question: "Choose the mobile acceptance color", options: ["Blue", "Green"] }] };
        }
        if (!toolResults.length && prompt.includes("mobile-approval")) {
          tool = "Bash"; args = { command: "echo mobile-approved" };
        }
        if (!toolResults.length && prompt.includes("mobile-plan") && body.tools?.some((item) => item.function.name === "SubmitPlan")) {
          tool = "SubmitPlan"; args = { title: "Mobile acceptance plan", markdown: "# Mobile acceptance plan\n\nConfirm the paired session, then report that execution has continued on the desktop. No files need changing.", question: "Run this plan on the desktop?" };
        }
        if (tool) {
          res.write(chunk({ tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }));
          res.write(chunk({}, "tool_calls")); res.end("data: [DONE]\n\n"); return;
        }
        finish(toolResults.length ? "Mobile decision received. Work continued on the computer." : "Reply from the desktop agent: mobile conversation synchronized."); return;
      }
      calls.push({ path: url.pathname, method: req.method });
      if (url.pathname === "/api/pi-mobile/auth/login") {
        if (!["mobileqa", "other"].includes(body.username) || body.password !== "mobile-pass") { fail("INVALID_CREDENTIALS", 401); return; }
        if (control.challenge) { json({ challenge: { challengeId: body.username, type: "totp" } }); return; }
        json({ session: issue(account(body.username)) }); return;
      }
      if (url.pathname === "/api/pi-mobile/auth/challenge") {
        if (body.code !== "123456") { fail("INVALID_CHALLENGE", 400); return; }
        json({ session: issue(account(body.challengeId)) }); return;
      }
      if (url.pathname === "/api/pi-mobile/auth/refresh") {
        const previous = refreshTokens.get(body.refreshToken);
        if (!previous) { fail("AUTH_EXPIRED", 401); return; }
        refreshTokens.delete(body.refreshToken); control.mobileRefreshes++;
        json({ session: issue(previous.user, previous.deviceId) }); return;
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, "");
      const auth = bearer === "fixture-access" ? { kind: "desktop", accountId: "901", deviceId: url.searchParams.get("deviceId") ?? undefined } : sessions.get(bearer);
      if (!auth) { fail("AUTH_EXPIRED", 401); return; }
      if (url.pathname === "/api/pi-mobile/auth/logout") {
        sessions.delete(bearer); refreshTokens.delete(body.refreshToken);
        for (const [id, peer] of peers) if (peer.mobileDeviceId === auth.deviceId) closePeer(id, "AUTH_EXPIRED");
        json({}); return;
      }
      if (url.pathname === "/api/pi-sync/devices/register") {
        const current = body.deviceId ? devices.get(body.deviceId) : undefined;
        if (current && current.accountId !== auth.accountId) { fail("ACCOUNT_MISMATCH", 403); return; }
        if (body.kind !== auth.kind) { fail("ACCOUNT_MISMATCH", 403); return; }
        const deviceId = current?.deviceId ?? `${auth.kind}-${randomUUID()}`;
        devices.set(deviceId, { deviceId, name: body.name, kind: body.kind, accountId: auth.accountId }); auth.deviceId = deviceId;
        json({ deviceId }); return;
      }
      if (url.pathname === "/api/pi-sync/devices") {
        const visible = new Set(grantList(auth).map((grant) => grant.desktopDeviceId));
        json({ devices: [...devices.values()].filter((device) => device.accountId === auth.accountId && (auth.kind === "desktop" || visible.has(device.deviceId))).map(({ accountId, ...device }) => ({ ...device, online: desktops.has(device.deviceId) })) }); return;
      }
      if (url.pathname === "/api/pi-sync/grants") { json({ grants: grantList(auth) }); return; }
      if (url.pathname === "/api/pi-sync/pairings" && req.method === "POST") {
        if (auth.kind !== "desktop" || devices.get(body.deviceId)?.accountId !== auth.accountId) { fail("ACCOUNT_MISMATCH", 403); return; }
        const pairing = { id: randomUUID(), code: String(++serial).padStart(8, "0"), expiresAt: new Date(Date.now() + 600_000).toISOString(), scope: body.scope };
        pairings.set(pairing.id, { pairing, desktopDeviceId: body.deviceId, accountId: auth.accountId, consumed: false });
        json({ pairing }); return;
      }
      if (url.pathname === "/api/pi-sync/pairings/claim") {
        const stored = [...pairings.values()].find((item) => item.pairing.code === body.code);
        if (!stored) { fail("PAIRING_INVALID", 404); return; }
        if (stored.accountId !== auth.accountId || auth.kind !== "mobile" || body.deviceId !== auth.deviceId) { fail("ACCOUNT_MISMATCH", 403); return; }
        if (stored.consumed) { fail("PAIRING_CONSUMED", 409); return; }
        if (Date.parse(stored.pairing.expiresAt) <= Date.now()) { fail("PAIRING_EXPIRED", 410); return; }
        stored.consumed = true;
        const grant = { id: randomUUID(), accountId: auth.accountId, desktopDeviceId: stored.desktopDeviceId, mobileDeviceId: auth.deviceId,
          mobileDeviceName: devices.get(auth.deviceId).name, scope: stored.pairing.scope, createdAt: new Date().toISOString() };
        grants.set(grant.id, grant); notify(grant.desktopDeviceId); json({ grant }); return;
      }
      const cancel = /^\/api\/pi-sync\/pairings\/([^/]+)\/cancel$/.exec(url.pathname);
      if (cancel) {
        const pending = pairings.get(cancel[1]);
        if (pending && (auth.kind !== "desktop" || pending.accountId !== auth.accountId)) { fail("ACCOUNT_MISMATCH", 403); return; }
        pairings.delete(cancel[1]); json({}); return;
      }
      const revoke = /^\/api\/pi-sync\/grants\/([^/]+)\/revoke$/.exec(url.pathname);
      if (revoke) {
        const grant = grants.get(revoke[1]);
        if (grant && !grantList(auth).some((item) => item.id === grant.id)) { fail("ACCOUNT_MISMATCH", 403); return; }
        if (grant) {
          grants.delete(grant.id); notify(grant.desktopDeviceId);
          for (const [id, peer] of peers) if (peer.mobileDeviceId === grant.mobileDeviceId && peer.desktopDeviceId === grant.desktopDeviceId) closePeer(id, "GRANT_REVOKED");
        }
        json({}); return;
      }
      if (url.pathname === "/api/pi-sync/relay/ticket") {
        if (control.relayUnavailable) { fail("RELAY_UNAVAILABLE", 503); return; }
        if (devices.get(body.deviceId)?.accountId !== auth.accountId || (auth.kind === "mobile" && body.deviceId !== auth.deviceId)) { fail("ACCOUNT_MISMATCH", 403); return; }
        if (auth.kind === "mobile" && !grantList(auth).some((grant) => grant.desktopDeviceId === body.desktopDeviceId)) { fail("GRANT_REVOKED", 403); return; }
        if (auth.kind === "mobile" && !desktops.has(body.desktopDeviceId)) { fail("DESKTOP_OFFLINE", 503); return; }
        const ticket = randomUUID(), expiresAt = new Date(Date.now() + 60_000).toISOString();
        tickets.set(ticket, { ...auth, deviceId: body.deviceId, desktopDeviceId: body.desktopDeviceId, expiresAt });
        json({ ticket, expiresAt, url: `${origin.replace("http:", "ws:")}/api/pi-sync/relay/connect` }); return;
      }
      fail("NOT_FOUND", 404);
    } catch (error) { if (!res.headersSent) fail("FIXTURE_ERROR", 500); else res.end(); console.error("Fixture boundary failed:", error.message); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, origin), ticket = tickets.get(url.searchParams.get("ticket"));
    if (!ticket || Date.parse(ticket.expiresAt) <= Date.now() || control.relayUnavailable) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
    tickets.delete(url.searchParams.get("ticket"));
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (ticket.kind === "desktop") {
        desktops.get(ticket.deviceId)?.close(4000, "REPLACED"); desktops.set(ticket.deviceId, ws);
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.type === "ping") send(ws, { type: "pong" });
          if (frame.type === "peer.frame" && peers.get(frame.peerId)?.desktopDeviceId === ticket.deviceId) {
            const peer = peers.get(frame.peerId), reply = JSON.parse(frame.frame);
            const method = peer.requests.get(reply.id);
            if (reply.id !== undefined) peer.requests.delete(reply.id);
            if (control.dropTurnReplyOnce && method === "turn/start" && reply.result) {
              control.dropTurnReplyOnce = false; closePeer(frame.peerId, "TEST_UNCONFIRMED_SEND");
            } else send(peer.socket, frame.frame);
          }
          if (frame.type === "peer.close") closePeer(frame.peerId, frame.reason ?? "closed");
        });
        ws.on("close", () => {
          if (desktops.get(ticket.deviceId) === ws) desktops.delete(ticket.deviceId);
          for (const [id, peer] of peers) if (peer.desktopDeviceId === ticket.deviceId) closePeer(id, "DESKTOP_OFFLINE");
        });
      } else {
        const desktop = desktops.get(ticket.desktopDeviceId);
        if (!desktop) { ws.close(4000, "DESKTOP_OFFLINE"); return; }
        const peerId = randomUUID();
        peers.set(peerId, { socket: ws, desktopDeviceId: ticket.desktopDeviceId, mobileDeviceId: ticket.deviceId, requests: new Map() });
        send(desktop, { type: "peer.open", peerId, accountId: ticket.accountId, deviceId: ticket.deviceId, grants: grantList(ticket).filter((grant) => grant.desktopDeviceId === ticket.desktopDeviceId) });
        ws.on("message", (data) => {
          const request = JSON.parse(data.toString());
          if (request.id !== undefined && request.method) peers.get(peerId)?.requests.set(request.id, request.method);
          send(desktop, { type: "peer.frame", peerId, frame: data.toString() });
        });
        ws.on("close", () => closePeer(peerId, "disconnected"));
      }
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, upstream, control, calls, chats, chatRequests, devices, pairings, grants, desktops, peers,
    expireMobileAccess() { sessions.clear(); },
    releaseChats() { for (const held of heldChats) { heldChats.delete(held); held.finish(); } },
    disconnectPhones() { for (const id of peers.keys()) closePeer(id, "TEST_DISCONNECT"); },
    close() { for (const socket of wss.clients) socket.terminate(); wss.close(); server.closeAllConnections(); server.close(); upstream.close(); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await mobileFixture({ port: Number(process.env.PI_MOBILE_FIXTURE_PORT ?? 0) });
  console.log(`Mobile acceptance fixture: ${fixture.origin}`);
  console.log("Test-only account: mobileqa / mobile-pass; optional verification code: 123456");
  process.once("SIGINT", () => { fixture.close(); process.exit(0); });
  process.once("SIGTERM", () => { fixture.close(); process.exit(0); });
}
