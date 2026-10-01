import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { IPC, KEYBOARD_SHORTCUTS, keybindingMatchesEvent, resolveKeybinding } from "@pi-desktop/shared";
import { useAppStore } from "../../src/stores/app-store";
import { PortalVisibilityProvider } from "../../src/lib/portal-visibility";
import { LiveVoiceControls } from "../../src/features/voice/live/LiveVoiceControls";
import { LiveVoiceStatusHost } from "../../src/features/voice/live/LiveVoiceStatusHost";
import { getLiveCallController } from "../../src/features/voice/live/live-call-controller";
import { runLiveVoiceShortcut } from "../../src/features/voice/live/live-voice-shortcuts";

// Only external IPC/provider/media edges are fake. No controller or UI method is replaced.
const listeners = new Map();
const gates = new Map();
const counts = Object.fromEntries([
  "prepare", "connect", "getUserMedia", "audioContext", "end", "released", "contextClose",
  "play", "pause", "mute", "peer", "trackStop",
].map((key) => [key, 0]));
const requests = { prepare: [], mute: [], end: [], unexpected: [] };
const errors = [];
const tracks = [];
const contexts = [];
const peers = [];
const settings = {
  liveVoice: { enabled: false, selectedBindingId: "fixture-selected", bindings: [
    { id: "fixture-selected", adapterId: "codex-live", providerId: "fixture-provider", voice: "cove" },
    { id: "fixture-other", adapterId: "codex-live", providerId: "fixture-other-provider", voice: "cove" },
  ] },
  voice: { deviceId: null }, keybindings: {},
};
const status = {
  enabled: false, settingsRevision: 1, selectedBindingId: "fixture-selected", call: null,
  bindings: [
    { bindingId: "fixture-selected", adapterId: "codex-live", providerLabel: "Selected fixture account", configured: true, credentialsPresent: true, selectable: true },
    { bindingId: "fixture-other", adapterId: "codex-live", providerLabel: "Other ready account", configured: true, credentialsPresent: true, selectable: true },
  ],
};
const sessions = ["Alpha", "Beta"].map((title, index) => ({
  id: `fixture-session-${index + 1}`, title, source: "desktop", projectPath: "/fixture/project",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", messageCount: 0,
}));
let call;
let callNumber = 0;
let rejectPlayback = false;
let rejectReleaseReport = false;
const ending = new Map();
const emit = (channel, value) => {
  for (const listener of listeners.get(channel) ?? []) listener(structuredClone(value));
};
const waitAt = (name) => gates.get(name)?.promise ?? Promise.resolve();
function updateCall(patch) {
  call = { ...call, ...patch, revision: (call?.revision ?? 0) + 1 };
  status.call = call;
  emit(IPC.event.liveVoiceChanged, call);
  return structuredClone(call);
}
function beginClosing() {
  if (!call || ["closing", "ended", "failed"].includes(call.phase)) return;
  updateCall({ phase: "closing" });
  emit(IPC.event.liveVoiceControl, { callId: call.callId, kind: "release-media" });
}
async function handleInvoke(channel, request) {
  switch (channel) {
    case IPC.invoke.settingsGet: return structuredClone(settings);
    case IPC.invoke.liveVoiceStatus: return structuredClone(status);
    case IPC.invoke.liveVoicePrepare: {
      counts.prepare += 1;
      requests.prepare.push(structuredClone(request));
      call = {
        callId: `fixture-call-${++callNumber}`, revision: 0, bindingId: request.bindingId,
        adapterId: "codex-live", phase: "preparing", muted: request.initialMuted,
        microphoneActive: false, userSpeaking: false, assistantSpeaking: false, mediaRelease: "pending",
        ...(request.workTarget ? { workBinding: {
          ...request.workTarget, workBindingRevision: 1,
          label: sessions.find((session) => session.id === request.workTarget.workSessionId)?.title ?? "Fixture session",
        } } : {}),
      };
      updateCall({});
      const prepared = {
        callId: call.callId, requestId: request.requestId, bindingId: call.bindingId,
        adapterId: call.adapterId, mediaKind: "webrtc", initialMuted: request.initialMuted,
        inputSampleRate: 24000, outputSampleRate: 24000, revision: call.revision,
      };
      await waitAt("prepare");
      return prepared;
    }
    case IPC.invoke.liveVoiceConnect:
      counts.connect += 1;
      await waitAt("connect");
      return { answerSdp: "v=0\r\n", revision: call.revision };
    case IPC.invoke.liveVoiceSetMuted:
      counts.mute += 1;
      requests.mute.push(structuredClone(request));
      return updateCall({ muted: request.muted });
    case IPC.invoke.liveVoiceReportMedia:
      if (request.kind === "released") {
        counts.released += 1;
        await waitAt("released");
        if (rejectReleaseReport) throw Object.assign(new Error("Fixture release acknowledgement refused"), { code: "LIVE_MEDIA_RELEASE_UNCONFIRMED" });
        return updateCall({ microphoneActive: false, mediaRelease: "confirmed" });
      }
      if (request.kind === "microphone-active") return updateCall({ microphoneActive: request.active });
      if (request.kind === "phase") return updateCall({ phase: request.phase });
      if (request.kind === "playback-blocked") return updateCall({ playbackBlocked: request.blocked });
      return structuredClone(call);
    case IPC.invoke.liveVoiceEnd: {
      counts.end += 1;
      requests.end.push(structuredClone(request));
      const key = request.callId ?? request.requestId;
      if (!ending.has(key)) ending.set(key, (async () => {
        beginClosing();
        await waitAt("end");
        if (call) updateCall({ phase: "ended" });
        return { ok: true };
      })());
      return ending.get(key);
    }
    case IPC.invoke.liveVoiceHeartbeat:
    case IPC.invoke.liveVoiceReportPlayback:
    case IPC.invoke.liveVoiceReportControlApplied:
      return { ok: true };
    default:
      requests.unexpected.push(channel);
      throw new Error(`Unexpected fixture IPC: ${channel}`);
  }
}
window.piDesktop = {
  platform: navigator.platform.includes("Mac") ? "darwin" : "linux",
  on(channel, listener) {
    const group = listeners.get(channel) ?? new Set();
    listeners.set(channel, group); group.add(listener);
    return () => group.delete(listener);
  },
  onLiveVoicePort: () => () => {},
  async invoke(channel, request) { return { ok: true, data: await handleInvoke(channel, request) }; },
};
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
  async getUserMedia() {
    counts.getUserMedia += 1;
    const track = { enabled: true, readyState: "live", stop() {
      if (this.readyState !== "ended") counts.trackStop += 1;
      this.readyState = "ended"; this.enabled = false;
    } };
    tracks.push(track);
    await waitAt("microphone");
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  },
} });
class FakePeer extends EventTarget {
  connectionState = "new";
  iceGatheringState = "complete";
  localDescription = null;
  channel = Object.assign(new EventTarget(), {
    readyState: "open", send() {}, close() { this.readyState = "closed"; },
  });
  constructor() { super(); counts.peer += 1; peers.push(this); }
  createDataChannel() { return this.channel; }
  addTrack() {}
  async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription() {
    if (this.connectionState === "closed") throw new DOMException("Fixture peer is closed", "InvalidStateError");
    this.connectionState = "connected";
    this.dispatchEvent(new Event("connectionstatechange"));
    this.ontrack?.({ streams: [{}] });
  }
  close() { this.connectionState = "closed"; this.dispatchEvent(new Event("connectionstatechange")); }
}
window.RTCPeerConnection = FakePeer;
class FakeAudioContext {
  state = "running";
  sampleRate = 48000;
  destination = {};
  constructor() { counts.audioContext += 1; contexts.push(this); }
  async resume() { this.state = "running"; }
  async close() { counts.contextClose += 1; await waitAt("contextClose"); this.state = "closed"; }
  createMediaElementSource() { return { connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 1024, connect() {}, disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(0); } }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
}
window.AudioContext = FakeAudioContext;
const mediaSources = new WeakMap();
Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
  configurable: true, get() { return mediaSources.get(this) ?? null; }, set(value) { mediaSources.set(this, value); },
});
HTMLMediaElement.prototype.play = async function () {
  counts.play += 1;
  if (rejectPlayback) throw Object.assign(new Error("Fixture playback blocked"), { code: "LIVE_PLAYBACK_FAILED" });
};
HTMLMediaElement.prototype.pause = function () { counts.pause += 1; };
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

await i18n.use(initReactI18next).init({
  lng: "en", fallbackLng: "en", keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } }, interpolation: { escapeValue: false },
});
useAppStore.setState({ sessions, activeSessionId: sessions[0].id, settings });
const controller = getLiveCallController();
function SimulatedShell() {
  const [route, setRoute] = useState("chat");
  const [hidden, setHidden] = useState(false);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  useEffect(() => {
    useAppStore.setState({ page: route });
  }, [route]);
  useEffect(() => {
    // Production matcher + dispatcher, not the unrelated full AppShell runtime.
    const onKeyDown = (event) => {
      if (event.repeat || event.defaultPrevented) return;
      const platform = window.piDesktop.platform;
      const shortcut = KEYBOARD_SHORTCUTS.find((item) => ["voiceToggle", "voiceCancel"].includes(item.id)
        && keybindingMatchesEvent(resolveKeybinding(item, settings.keybindings, platform), event, platform));
      if (shortcut && runLiveVoiceShortcut(shortcut.id)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div style={{ minHeight: "100vh", padding: 32 }}>
      <nav aria-label="Fixture shell navigation" style={{ display: "flex", gap: 16 }}>
        <button onClick={() => setRoute("settings")}>Fixture settings route</button>
        <button onClick={() => { setRoute("chat"); setHidden(false); }}>Fixture chat route</button>
        <button onClick={() => setHidden((value) => !value)}>Fixture toggle composer visibility</button>
        <button onClick={() => useAppStore.setState({ activeSessionId: sessions[1].id })}>Fixture switch session</button>
      </nav>
      <main><p>Simulated shell boundary, not a mounted AppShell.</p></main>
      {route === "chat" ? (
        <PortalVisibilityProvider visible={!hidden}>
          <div data-fixture-composer hidden={hidden} style={{ position: "absolute", bottom: 72, left: 64 }}>
            <LiveVoiceControls t={i18n.t.bind(i18n)} workSessionId={activeSessionId} workSessionLabel="Fixture project / Alpha" />
          </div>
        </PortalVisibilityProvider>
      ) : <p data-fixture-settings>Settings route: composer unmounted</p>}
      <LiveVoiceStatusHost />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<SimulatedShell />);
window.liveVoiceFixture = {
  hold(name) {
    if (gates.has(name)) throw new Error(`Gate already held: ${name}`);
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    gates.set(name, { promise, resolve });
  },
  release(name) {
    const gate = gates.get(name);
    if (!gate) throw new Error(`Gate not held: ${name}`);
    gates.delete(name); gate.resolve();
  },
  async configure(patch) {
    if (patch.enabled !== undefined) status.enabled = settings.liveVoice.enabled = patch.enabled;
    if (patch.selectedAvailable !== undefined) {
      status.bindings[0].selectable = patch.selectedAvailable;
      status.bindings[0].credentialsPresent = patch.selectedAvailable;
      status.bindings[0].reason = patch.selectedAvailable ? undefined : "missing-credentials";
    }
    status.settingsRevision += 1;
    emit(IPC.event.settingsChanged, { liveVoice: settings.liveVoice });
    await controller.refreshStatus();
  },
  blockPlayback(blocked) { rejectPlayback = blocked; },
  beginClosing,
  setPhase(phase) { updateCall({ phase }); },
  switchSession(sessionId) { useAppStore.setState({ activeSessionId: sessionId }); },
  failReleaseReport() { rejectReleaseReport = true; },
  terminal() { updateCall({ phase: "ended" }); },
  terminalUnconfirmed() {
    updateCall({ phase: "failed", mediaRelease: "unconfirmed", error: {
      code: "LIVE_MEDIA_RELEASE_UNCONFIRMED", stage: "cleanup", retriable: false,
    } });
  },
  async attemptStart() {
    try { await controller.start(); return null; }
    catch (error) { return error && typeof error === "object" && "code" in error ? error.code : "unknown"; }
  },
  transcript(text) {
    emit(IPC.event.liveVoiceTranscript, { callId: call.callId,
      segment: { id: "fixture-transcript", role: "assistant", text, final: true, timestamp: 0 } });
  },
  inspect() {
    return {
      snapshot: controller.getSnapshot(), counts, requests, errors,
      tracks: tracks.map(({ enabled, readyState }) => ({ enabled, readyState })),
      contexts: contexts.map(({ state }) => ({ state })),
      peers: peers.map(({ connectionState }) => ({ connectionState })), held: [...gates.keys()],
    };
  },
};
