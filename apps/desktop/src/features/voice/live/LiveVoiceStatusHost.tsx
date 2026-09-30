import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../stores/app-store";
import { getLiveCallController } from "./live-call-controller";
import { openLiveVoiceSettings } from "./live-voice-navigation";
import { hasUnconfirmedMediaRelease, liveVoiceIssue, liveVoiceMode } from "./live-voice-presentation";
import { LiveVoiceCallBar } from "./LiveVoiceCallBar";
import { LiveVoiceDetails } from "./LiveVoiceDetails";
import "../../../styles/voice.css";

/** Call chrome survives route changes; mounting it never owns or starts media. */
export function LiveVoiceStatusHost() {
  const { t } = useTranslation();
  const page = useAppStore((state) => state.page);
  const controller = getLiveCallController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dismissedIssue, setDismissedIssue] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<"mute" | "playback" | null>(null);
  const [actionFailure, setActionFailure] = useState<{ callId?: string; code: string } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const mode = liveVoiceMode(snapshot);
  const previousMode = useRef(mode);
  const callId = snapshot.call?.callId;
  const issue = liveVoiceIssue(actionFailure && actionFailure.callId === callId
    ? { ...snapshot, errorCode: snapshot.errorCode ?? actionFailure.code }
    : snapshot);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);

  useEffect(() => {
    setDetailsOpen(false);
    setDismissedIssue(null);
    setActionFailure(null);
    setActionPending(null);
  }, [callId]);

  useEffect(() => {
    if (mode === "connecting") setDismissedIssue(null);
    if (mode === "stopping" || mode === "idle") setDetailsOpen(false);
    if ((mode === "connecting" && previousMode.current === "idle") ||
      (mode === "connected" && document.activeElement === document.body)) {
      hostRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
    previousMode.current = mode;
  }, [mode]);

  const runAction = (action: () => Promise<void>, pending?: "mute" | "playback") => {
    setActionFailure(null);
    if (pending) setActionPending(pending);
    void action().catch(() => {
      if (controller.getSnapshot().call?.callId === callId) {
        setActionFailure({ callId, code: pending === "playback" ? "LIVE_PLAYBACK_FAILED" : "LIVE_CALL_ACTION_FAILED" });
      }
    }).finally(() => {
      if (controller.getSnapshot().call?.callId === callId) setActionPending(null);
    });
  };

  const releaseUnconfirmed = hasUnconfirmedMediaRelease(snapshot);
  const hasVisibleIssue = issue && (releaseUnconfirmed || issue.key !== dismissedIssue) &&
    (snapshot.status?.enabled === true || snapshot.call?.error || releaseUnconfirmed);
  if (mode === "idle" && !hasVisibleIssue) return null;

  return (
    <div ref={hostRef} className="live-voice-status-host" data-chat={page === "chat"} role="region" aria-label={t("liveVoice.title")}>
      <LiveVoiceCallBar
        t={t}
        snapshot={snapshot}
        issue={issue}
        detailsOpen={detailsOpen}
        detailsRef={detailsRef}
        actionPending={actionPending}
        onCancel={() => runAction(() => snapshot.starting ? controller.cancelStart() : controller.end())}
        onMute={() => runAction(() => controller.toggleMute(), "mute")}
        onEnd={() => runAction(() => controller.end())}
        onDetails={() => setDetailsOpen((value) => !value)}
        onResume={() => runAction(() => controller.resumePlayback(), "playback")}
        onSettings={openLiveVoiceSettings}
        onDismiss={() => { setDismissedIssue(issue?.key ?? null); setDetailsOpen(false); }}
      />
      {snapshot.call ? (
        <LiveVoiceDetails
          key={snapshot.call.callId}
          t={t}
          call={snapshot.call}
          status={snapshot.status}
          transcripts={snapshot.transcripts}
          open={detailsOpen}
          onClose={closeDetails}
          anchorRef={detailsRef}
        />
      ) : null}
    </div>
  );
}
