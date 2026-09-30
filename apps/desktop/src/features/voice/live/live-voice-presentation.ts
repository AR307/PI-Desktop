import type { LiveStatus } from "@pi-desktop/shared";
import type { LiveVoiceSnapshot } from "./live-call-controller";
import { liveVoiceErrorKey } from "./live-voice-error";

export type LiveVoiceMode = "idle" | "connecting" | "reconnecting" | "connected" | "stopping";

export function liveVoiceMode(snapshot: LiveVoiceSnapshot): LiveVoiceMode {
  if (snapshot.stopping || snapshot.call?.phase === "closing") return "stopping";
  if (snapshot.starting) return "connecting";
  switch (snapshot.call?.phase) {
    case "connected": return "connected";
    case "reconnecting": return "reconnecting";
    case "preparing":
    case "acquiring-mic":
    case "negotiating":
    case "connecting": return "connecting";
    default: return "idle";
  }
}

export function hasUnconfirmedMediaRelease(snapshot: LiveVoiceSnapshot): boolean {
  return snapshot.call?.error?.code === "LIVE_MEDIA_RELEASE_UNCONFIRMED" || snapshot.errorCode === "LIVE_MEDIA_RELEASE_UNCONFIRMED";
}

export function selectedLiveBinding(status: LiveStatus | null) {
  return status?.bindings.find((binding) => binding.bindingId === status.selectedBindingId);
}

export function liveReadinessMessage(status: LiveStatus | null): string | null {
  if (!status?.enabled) return "liveVoice.enableInSettings";
  const binding = selectedLiveBinding(status);
  if (!binding) return "liveVoice.noProvider";
  if (!binding.selectable) return `liveVoice.readiness.${binding.reason ?? "invalid-settings"}`;
  return null;
}

const ERROR_MESSAGES: Record<string, string> = {
  LIVE_MICROPHONE_DENIED: "liveVoice.microphoneDenied",
  LIVE_MICROPHONE_BUSY: "liveVoice.microphoneBusy",
  LIVE_MICROPHONE_UNAVAILABLE: "liveVoice.microphoneUnavailable",
  LIVE_MEDIA_RELEASE_UNCONFIRMED: "liveVoice.mediaReleaseUnconfirmed",
  LIVE_PLAYBACK_BLOCKED: "liveVoice.playbackBlocked",
  LIVE_PLAYBACK_FAILED: "liveVoice.playbackFailed",
  LIVE_NOT_CONFIGURED: "liveVoice.noProvider",
  LIVE_DISABLED: "liveVoice.enableInSettings",
  LIVE_EXECUTION_NOT_CONNECTED: "liveVoice.workNotConnected",
  LIVE_CALL_ACTION_FAILED: "liveVoice.callActionFailed",
};

export function liveVoiceIssue(snapshot: LiveVoiceSnapshot) {
  const { call } = snapshot;
  const terminal = call?.phase === "ended" || call?.phase === "failed" || call?.phase === "idle";
  const notice = terminal || (call?.notice?.code === "LIVE_PLAYBACK_BLOCKED" && !call.playbackBlocked)
    ? undefined
    : call?.notice?.code;
  const code = call?.error?.code === "LIVE_MEDIA_RELEASE_UNCONFIRMED" || snapshot.errorCode === "LIVE_MEDIA_RELEASE_UNCONFIRMED"
    ? "LIVE_MEDIA_RELEASE_UNCONFIRMED"
    : call?.error?.code ?? snapshot.errorCode ?? notice
    ?? (!terminal && call?.playbackBlocked ? "LIVE_PLAYBACK_BLOCKED" : undefined);
  if (!code) return null;
  // The bar must name the actual cause: the call-specific table wins,
  // `liveVoiceErrorKey` covers the account/transport codes, and only genuinely
  // unmapped codes fall back — a network failure no longer reads as a generic
  // "check your service configuration" problem. Only this key and the verbatim
  // code reach the bar; a raw provider or credential message never does.
  const mapped = ERROR_MESSAGES[code] ?? liveVoiceErrorKey(code);
  const message = mapped !== "liveVoice.errorGeneric"
    ? mapped
    : code.startsWith("LIVE_WORK_") ? "liveVoice.workActionFailed"
    : call?.phase === "connected" ? "liveVoice.callActionFailed"
    : "liveVoice.errorGeneric";
  return {
    code,
    key: `${call?.callId ?? "start"}:${code}`,
    message,
    warning: code === "LIVE_PLAYBACK_BLOCKED",
  };
}

export function formatWorkSessionLabel(projectPath: string | undefined, title: string, untitledLabel: string) {
  const projectLabel = projectPath?.split(/[\\/]/).filter(Boolean).at(-1);
  const sessionLabel = title.trim() || untitledLabel;
  return projectLabel ? `${projectLabel} / ${sessionLabel}` : sessionLabel;
}
