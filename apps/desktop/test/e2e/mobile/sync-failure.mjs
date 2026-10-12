import assert from "node:assert/strict";

/** Fault only the external relay reply; real controller, cache and UI stay wired. */
export async function syncFailureAcceptance({ fixture, device, phone, view, until, check, screenshot, close, withHost, launch, backHome, openSession }) {
  await backHome();
  await close(device);
  await withHost(device, async host => {
    const { session } = await host.call("session.get", { id: device.session.id });
    session.messages[0].content = "First changed row retained after second page fails";
    session.messages[1].content = "Second changed row recovered by explicit retry";
    await host.call("session.replaceMessages", { sessionId: device.session.id, messages: session.messages });
  });
  await launch(device);
  await until(() => [...fixture.peers.values()].some(peer => peer.desktopDeviceId === device.deviceId), "reconnected relay for fault test");
  const [peerId, peer] = [...fixture.peers].find(([, peer]) => peer.desktopDeviceId === device.deviceId);
  const send = peer.socket.send;
  let failed = false, pending;
  let cursor;
  peer.socket.send = function (data, ...args) {
    const frame = JSON.parse(data.toString());
    const call = fixture.relayCalls.findLast(call => call.peerId === peerId && call.id === frame.id);
    if (call?.method === "session/attach") cursor = frame.result?.state?.cursor;
    if (call?.method === "session/changes" && call.sessionId === device.session.id) {
      if (!failed && frame.result?.changes.length > 1) {
        const first = frame.result.changes[0];
        frame.result = { ...frame.result, changes: [first], revision: first.revision, hasMore: true };
        return send.call(this, JSON.stringify(frame), ...args);
      }
      if (!failed && cursor) {
        const message = { id: device.name + "-3", role: "assistant", content: "Live progress received while history sync failed", status: "streaming", createdAt: "2026-01-01T00:00:03.000Z" };
        send.call(this, JSON.stringify({ jsonrpc: "2.0", method: "session/event", params: {
          eventId: "sync-error-live-progress", scope: "session", sessionId: device.session.id,
          epoch: cursor.epoch, afterSequence: cursor.sequence, revision: 0, kind: "item.delta", occurredAt: message.createdAt,
          payload: { event: { type: "message_update", message } },
        } }));
      }
      failed = true;
      pending = { ...frame, result: undefined, error: { code: -32000, message: "expected value at line 1 column 1", data: { code: "INTERNAL", message: "expected value at line 1 column 1", retriable: false } } };
      return send.call(this, JSON.stringify(pending), ...args);
    }
    return send.call(this, data, ...args);
  };
  try {
    await openSession(device);
    await until(async () => Boolean((await view()).syncError), "history failure is visible");
    const state = await view();
    check("failed delta page keeps earlier committed changes visible", state.messages.find(message => message.id === device.name + "-0")?.content === "First changed row retained after second page fails");
    check("failed cached attach still restores live controls and model catalog", Boolean(state.snapshot && state.catalog) && !state.loading);
    assert(cursor, "cached attach returned its live event cursor");
    await until(async () => (await view()).messages.some(message => message.content === "Live progress received while history sync failed"), "buffered live event survives failed history sync");
    check("buffered live event survives failed history sync");
    await phone.locator(".history-sync-notice details summary").click();
    assert.match(await phone.locator(".history-sync-notice").innerText(), /expected value at line 1 column 1/);
    await screenshot("mobile-history-sync-error");
  } finally { peer.socket.send = send; }
  const beforeRetry = fixture.relayCalls.length;
  await phone.getByRole("button", { name: "Retry history sync", exact: true }).click();
  await until(async () => !(await view()).syncError, "explicit history retry succeeds");
  check("retry fills missing page without losing the earlier one", (await view()).messages[0].content === "First changed row retained after second page fails" && (await view()).messages[1].content === "Second changed row recovered by explicit retry");
  check("history retry sends no prompt or full snapshot", !fixture.relayCalls.slice(beforeRetry).some(call => ["turn/start", "session/snapshot"].includes(call.method)));
  await screenshot("mobile-history-sync-recovered");
}
