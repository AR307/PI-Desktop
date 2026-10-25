import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "../../components/Composer";
import { ChatTranscript } from "./transcript/ChatTranscript";
import { useTranscriptView } from "../../hooks/use-transcript-view";
import { useAppStore } from "../../stores/app-store";
import { headPermission, queuedPermissionCount } from "../../lib/pending-permissions";
import { headAsk } from "../../lib/pending-asks";
import { SlotSessionProvider } from "../../plugins/renderer-slots/use-slots";
import "./side-chat.css";

export function SideChatPane({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const { messages } = useTranscriptView(sessionId);
  const running = useAppStore((s) => !!s.runningSessions[sessionId]);
  const permission = useAppStore((s) => headPermission(s.pendingPermissions, sessionId));
  const permissions = useAppStore((s) => queuedPermissionCount(s.pendingPermissions, sessionId));
  const ask = useAppStore((s) => headAsk(s.pendingAsks, sessionId));
  const planning = useAppStore((s) => s.planningStates[sessionId]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(".composer-input")?.focus();
    void useAppStore.getState().restorePendingInteractive(sessionId);
    void useAppStore.getState().refreshQueuedPrompts(sessionId);
  }, [sessionId]);
  return (
    <SlotSessionProvider sessionId={sessionId}>
      <section
        ref={root}
        className="side-chat-pane"
        data-side-chat={sessionId}
        role="tabpanel"
        id={`work-panel-surface-side-chat:${sessionId}`}
        aria-labelledby={`work-panel-tab-side-chat:${sessionId}`}
      >
        <small className="side-chat-notice">{t("chat.sideChat.sharedWorkspace")}</small>
        <ChatTranscript
          sessionId={sessionId}
          messages={messages}
          isRunning={running}
          pendingPermission={permission}
          queuedPermissions={permissions}
          askPending={!!ask}
          planningState={planning}
        />
        <Composer key={sessionId} sessionId={sessionId} />
      </section>
    </SlotSessionProvider>
  );
}
