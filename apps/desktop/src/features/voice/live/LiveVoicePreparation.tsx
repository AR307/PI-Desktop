import { useEffect, useId, useState } from "react";
import type { TFunction } from "i18next";
import type { LiveStatus } from "@pi-desktop/shared";
import { IconCheck, IconChevronDown, IconClose, IconLink, IconPlay, IconPlus, IconSettings } from "../../../components/icons";
import { Button, Checkbox, Panel, Select, TooltipButton } from "../../../components/ui";
import { useAppStore } from "../../../stores/app-store";
import { getLiveCallController } from "./live-call-controller";
import { openLiveVoiceSettings } from "./live-voice-navigation";
import { formatWorkSessionLabel, liveReadinessMessage, selectedLiveBinding } from "./live-voice-presentation";

export function LiveVoicePreparation({
  t,
  status,
  workSessionId,
  onClose,
}: {
  t: TFunction;
  status: LiveStatus | null;
  workSessionId?: string;
  onClose: () => void;
}) {
  const sessions = useAppStore((state) => state.sessions);
  const createSession = useAppStore((state) => state.newSession);
  const [workExpanded, setWorkExpanded] = useState(false);
  const [allowWork, setAllowWork] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(workSessionId ?? "");
  const [contextEnabled, setContextEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  useEffect(() => {
    setSelectedSessionId(workSessionId ?? "");
    setContextEnabled(false);
  }, [workSessionId]);
  const workId = useId();
  const consentId = useId();
  const localSessions = sessions.filter((session) => session.source === undefined || session.source === "desktop");
  const selectedSession = localSessions.find((session) => session.id === selectedSessionId);
  const binding = selectedLiveBinding(status);
  const readinessMessage = liveReadinessMessage(status);
  const workUnavailable = allowWork && !selectedSession;

  const createWorkSession = async () => {
    setCreating(true);
    setCreateFailed(false);
    try {
      await createSession();
      const id = useAppStore.getState().activeSessionId;
      if (id) setSelectedSessionId(id);
      else setCreateFailed(true);
      setContextEnabled(false);
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Panel className="live-voice-preparation">
      <div className="live-voice-panel-heading">
        <strong>{t("liveVoice.prepareCall")}</strong>
        <TooltipButton type="button" className="icon-btn icon-btn-square" tooltip={t("common.close")} onClick={onClose}>
          <IconClose size={15} aria-hidden="true" />
        </TooltipButton>
      </div>
      <div className="live-voice-service-row">
        <div className="live-voice-service-label">
          <span className="live-voice-hint">{t("liveVoice.provider")}</span>
          <strong>{binding?.providerLabel ?? t("liveVoice.chooseProvider")}</strong>
        </div>
        <TooltipButton type="button" className="icon-btn icon-btn-square" tooltip={t("errors.action.openSettings")} onClick={() => { onClose(); openLiveVoiceSettings(); }}>
          <IconSettings size={16} aria-hidden="true" />
        </TooltipButton>
      </div>
      {readinessMessage ? <p className="live-voice-hint" role="status">{t(readinessMessage)}</p> : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="live-voice-work-disclosure"
        aria-expanded={workExpanded}
        aria-controls={workId}
        onClick={() => setWorkExpanded((value) => !value)}
      >
        <IconLink size={15} aria-hidden="true" />
        <span>{t("liveVoice.workOptions")}</span>
        {allowWork ? <IconCheck size={14} aria-hidden="true" /> : null}
        <IconChevronDown size={14} className={workExpanded ? "is-expanded" : undefined} aria-hidden="true" />
      </Button>
      {workExpanded ? (
        <div className="live-voice-work-setup" id={workId}>
          <Checkbox
            checked={allowWork}
            label={t("liveVoice.allowWork")}
            onChange={(event) => { setAllowWork(event.currentTarget.checked); setContextEnabled(false); }}
          />
          {allowWork ? (
            <>
              <Select
                value={selectedSession?.id ?? ""}
                aria-label={t("liveVoice.selectWorkSession")}
                disabled={creating}
                onChange={(event) => { setSelectedSessionId(event.currentTarget.value); setContextEnabled(false); }}
              >
                <option value="">{t("liveVoice.selectWorkSession")}</option>
                {localSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatWorkSessionLabel(session.projectPath, session.title, t("liveVoice.untitledWorkSession"))}
                  </option>
                ))}
              </Select>
              <Checkbox
                checked={contextEnabled}
                disabled={!selectedSession || creating}
                label={t("liveVoice.shareContext")}
                aria-describedby={consentId}
                onChange={(event) => setContextEnabled(event.currentTarget.checked)}
              />
              <p id={consentId} className="live-voice-hint">{t("liveVoice.contextConsent")}</p>
              <TooltipButton type="button" className="icon-btn icon-btn-square" tooltip={t("liveVoice.createWorkSession")} disabled={creating} onClick={() => void createWorkSession()}>
                {creating ? <span className="voice-spinner" aria-hidden="true" /> : <IconPlus size={15} aria-hidden="true" />}
              </TooltipButton>
            </>
          ) : null}
        </div>
      ) : null}
      {workUnavailable ? <p className="live-voice-hint" role="status">{t("liveVoice.noWorkSession")}</p> : null}
      {createFailed ? <p className="live-voice-error" role="alert">{t("liveVoice.sessionCreateFailed")}</p> : null}
      <Button
        type="button"
        variant="primary"
        className="live-voice-start"
        disabled={Boolean(readinessMessage) || workUnavailable || creating}
        onClick={() => {
          const options = allowWork && selectedSession
            ? { workTarget: { workSessionId: selectedSession.id, contextEnabled } }
            : {};
          void getLiveCallController().start(options).catch(() => undefined);
          onClose();
        }}
      >
        <IconPlay size={16} aria-hidden="true" />
        {t("liveVoice.start")}
      </Button>
    </Panel>
  );
}
