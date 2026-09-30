import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const binding = { bindingId: "voice-a", adapterId: "codex-live", configured: true, credentialsPresent: true, selectable: true, providerLabel: "Fixture voice" };
const status = { enabled: true, settingsRevision: 1, selectedBindingId: binding.bindingId, bindings: [binding], call: null };
const call = { callId: "call-a", revision: 1, bindingId: binding.bindingId, adapterId: binding.adapterId, phase: "connected", muted: true, microphoneActive: true, userSpeaking: false, assistantSpeaking: false };
const snapshot = { status, call: null, transcripts: [], starting: false, stopping: false };

test("Live Voice separates idle entry and compact call presentation", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let currentStatus = { ...status, enabled: false };
  const requests = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "http://localhost" },
      addEventListener() {},
      removeEventListener() {},
      piDesktop: {
        on: () => () => undefined,
        invoke: async (channel) => {
          requests.push(channel);
          if (channel === "pi-desktop/voice/live/status") return { ok: true, data: currentStatus };
          if (channel === "pi-desktop/settings/get") return { ok: true, data: {} };
          throw new Error(`Unexpected IPC request: ${channel}`);
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });

  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { LiveVoiceControls } = await server.ssrLoadModule("/src/features/voice/live/LiveVoiceControls.tsx");
  const { LiveVoiceCallBar } = await server.ssrLoadModule("/src/features/voice/live/LiveVoiceCallBar.tsx");
  const { getLiveCallController } = await server.ssrLoadModule("/src/features/voice/live/live-call-controller.ts");
  const { liveVoiceMode, liveVoiceIssue, liveReadinessMessage, hasUnconfirmedMediaRelease } = await server.ssrLoadModule("/src/features/voice/live/live-voice-presentation.ts");
  const translate = (key) => key;
  const controller = getLiveCallController();
  const renderEntry = () => renderToStaticMarkup(React.createElement(LiveVoiceControls, { t: translate, workSessionId: "work-a" }));
  const renderBar = (next, issue = liveVoiceIssue(next)) => renderToStaticMarkup(React.createElement(LiveVoiceCallBar, {
    t: translate, snapshot: next, issue, detailsOpen: false, detailsRef: { current: null }, actionPending: null,
    onCancel() {}, onMute() {}, onEnd() {}, onDetails() {}, onResume() {}, onSettings() {}, onDismiss() {},
  }));

  await t.test("disabled hides both the voice and work entry", async () => {
    await controller.refreshStatus();
    assert.equal(renderEntry(), "");
  });

  await t.test("enabled idle exposes exactly one preparation trigger", async () => {
    currentStatus = status;
    await controller.refreshStatus();
    const html = renderEntry();
    assert.equal((html.match(/<button\b/g) ?? []).length, 1);
    assert.match(html, /aria-label="liveVoice\.title"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.doesNotMatch(html, /role="dialog"|liveVoice\.openWorkSetup/);
    assert.ok(requests.every((channel) => channel.endsWith("/status") || channel.endsWith("/get")));
  });

  await t.test("readiness belongs to the selected binding, not any available account", () => {
    assert.equal(liveReadinessMessage(status), null);
    assert.equal(liveReadinessMessage({ ...status, selectedBindingId: "missing" }), "liveVoice.noProvider");
    assert.equal(liveReadinessMessage({ ...status, bindings: [{ ...binding, selectable: false, reason: "missing-credentials" }, { ...binding, bindingId: "other" }] }), "liveVoice.readiness.missing-credentials");
  });

  await t.test("cleanup wins over terminal views and disabled settings", () => {
    assert.equal(liveVoiceMode({ ...snapshot, starting: true }), "connecting");
    assert.equal(liveVoiceMode({ ...snapshot, call }), "connected");
    const reconnecting = { ...snapshot, call: { ...call, phase: "reconnecting" } };
    assert.equal(liveVoiceMode(reconnecting), "reconnecting");
    const reconnectingHtml = renderBar(reconnecting);
    assert.match(reconnectingHtml, /liveVoice\.phase\.reconnecting/);
    assert.match(reconnectingHtml, /aria-label="liveVoice\.end"/);
    assert.doesNotMatch(reconnectingHtml, /aria-label="common\.cancel"|aria-label="liveVoice\.unmute"/);
    const closing = { ...snapshot, status: { ...status, enabled: false }, call: { ...call, phase: "ended" }, stopping: true };
    assert.equal(liveVoiceMode(closing), "stopping");
    const html = renderBar(closing);
    assert.match(html, /data-state="stopping"/);
    assert.match(html, /role="status"/);
    assert.match(html, /liveVoice\.phase\.closing/);
    assert.doesNotMatch(html, /<button\b/);
    assert.equal(liveVoiceMode({ ...closing, stopping: false }), "idle");
  });

  await t.test("connected mute, end and details stay directly reachable", () => {
    const html = renderBar({ ...snapshot, call });
    assert.match(html, /liveVoice\.muted/);
    for (const key of ["unmute", "end", "details"]) assert.match(html, new RegExp(`aria-label="liveVoice\\.${key}"`));
    assert.doesNotMatch(html, /role="dialog"/);
  });

  await t.test("playback recovery and Main errors are visible without details", () => {
    const blocked = { ...snapshot, call: { ...call, playbackBlocked: true } };
    assert.match(renderBar(blocked), /aria-label="liveVoice\.resumePlayback"/);
    assert.match(renderBar(blocked), /liveVoice\.playbackBlocked/);
    const failure = { ...snapshot, call: { ...call, phase: "failed", error: { code: "LIVE_MEDIA_RELEASE_UNCONFIRMED", retriable: false } } };
    const failureHtml = renderBar(failure);
    assert.match(failureHtml, /role="alert"/);
    assert.match(failureHtml, /liveVoice\.mediaReleaseUnconfirmed/);
    assert.doesNotMatch(failureHtml, /aria-label="errors\.action\.dismiss"/);
    const quarantined = liveVoiceIssue({
      ...snapshot,
      call: { ...call, phase: "failed", error: { code: "LIVE_CALL_ACTION_FAILED", retriable: false } },
      errorCode: "LIVE_MEDIA_RELEASE_UNCONFIRMED",
    });
    assert.equal(quarantined.code, "LIVE_MEDIA_RELEASE_UNCONFIRMED");
    assert.equal(quarantined.message, "liveVoice.mediaReleaseUnconfirmed");
    assert.equal(hasUnconfirmedMediaRelease({ ...snapshot, errorCode: "LIVE_MEDIA_RELEASE_UNCONFIRMED" }), true);
    assert.equal(liveVoiceIssue({ ...snapshot, call: { ...call, playbackBlocked: false, notice: { code: "LIVE_PLAYBACK_BLOCKED", retriable: true } } }), null);
    assert.equal(liveVoiceIssue({ ...snapshot, call: { ...call, notice: { code: "LIVE_EXECUTION_NOT_CONNECTED", retriable: false } } }).message, "liveVoice.workNotConnected");
  });
  await t.test("a stopped call names its real cause and shows the verbatim error code", () => {
    const failed = { ...snapshot, call: { ...call, phase: "failed", error: { code: "LIVE_NETWORK_ERROR", retriable: true } } };
    assert.equal(liveVoiceIssue(failed).message, "errors.NETWORK_ERROR");
    const html = renderBar(failed);
    assert.match(html, /errors\.NETWORK_ERROR/);
    assert.match(html, /<code class="live-voice-error-code">LIVE_NETWORK_ERROR<\/code>/);
    // account failures read as account failures, not as generic configuration advice
    const auth = liveVoiceIssue({ ...snapshot, call: { ...call, phase: "failed", error: { code: "LIVE_AUTH_REQUIRED", retriable: false } } });
    assert.equal(auth.message, "liveVoice.authRequired");
    // genuinely new codes still fall back, with the code visible for a report
    const unknown = liveVoiceIssue({ ...snapshot, call: { ...call, phase: "failed", error: { code: "LIVE_SOMETHING_NEW", retriable: false } } });
    assert.equal(unknown.message, "liveVoice.errorGeneric");
    assert.equal(unknown.code, "LIVE_SOMETHING_NEW");
  });
});
