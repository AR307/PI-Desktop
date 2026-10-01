import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconStop } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";

/** Stop only delegates; parent Stop and delegate cancellation are independent. */
export function SubagentStopButton({ delegationId }: { delegationId?: string }) {
  const { t } = useTranslation();
  const sessionId = useAppStore((state) => state.activeSessionId);
  const showToast = useAppStore((state) => state.showToast);
  const [pending, setPending] = useState(false);
  const label = t(pending ? "chat.subagentStopPending" : delegationId ? "chat.stopSubagent" : "chat.stopAllSubagents");
  return <TooltipButton
    type="button"
    className="subagent-stop-button"
    ariaLabel={label}
    tooltip={label}
    disabled={pending || !sessionId}
    onClick={async (event) => {
      event.stopPropagation();
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const result = await api.stopDelegations(sessionId, delegationId ? [delegationId] : undefined);
        if (result.pending.length) showToast(t("chat.subagentStopPending"));
      } catch (error) {
        showToast(t("chat.subagentStopFailed", { reason: error instanceof Error ? error.message : String(error) }));
      } finally {
        setPending(false);
      }
    }}
  ><IconStop size={12} /></TooltipButton>;
}
