import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { IPC } from "@pi-desktop/shared";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
register(new URL("./helpers/native-session-electron-hook.mjs", import.meta.url));
const { createAgentHostBridge } = await import("../electron/main/agent-host-bridge.ts");

test("AgentHost work controls require explicit structured acknowledgements", async () => {
  let response;
  const bridge = createAgentHostBridge({
    channels: IPC.invoke,
    getHost: () => null,
    log: () => undefined,
    async invoke() { return response; },
  });

  const steer = { sessionId: "session-a", expectedTurnId: "turn-1", content: "Add a check", userMessageId: "message-1", voiceOrigin: { callId: "call-1", operationId: "op-1" } };
  response = undefined;
  assert.equal(await bridge.steerWorkSession(steer), false);
  response = {};
  assert.equal(await bridge.steerWorkSession(steer), false);
  response = { accepted: false };
  assert.equal(await bridge.steerWorkSession(steer), false);
  response = { accepted: true };
  assert.equal(await bridge.steerWorkSession(steer), true);

  response = undefined;
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "graceful" }), { status: "stale-target" });
  response = {};
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "graceful" }), { status: "stale-target" });
  response = { requested: true };
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "graceful" }), { status: "requested" });

  response = {};
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "immediate" }), { status: "stale-target" });
  response = { aborted: true };
  assert.deepEqual(await bridge.stopWorkSession({ sessionId: "session-a", expectedTurnId: "turn-1", urgency: "immediate" }), { status: "requested" });
});
