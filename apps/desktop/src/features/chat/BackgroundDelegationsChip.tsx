import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/app-store";

/**
 * Idle-session hint that detached delegates are still working (D628). Rendered
 * above the docked composer only while the active session itself is not
 * running; a running turn already explains itself through the turn activity
 * indicator, and the count comes from `AgentStatus.backgroundDelegations`.
 */
export function BackgroundDelegationsChip() {
  const { t } = useTranslation();
  const count = useAppStore((state) =>
    state.activeSessionId
      ? (state.backgroundDelegations[state.activeSessionId] ?? 0)
      : 0,
  );
  const running = useAppStore((state) =>
    state.activeSessionId
      ? (state.runningSessions[state.activeSessionId] ?? false)
      : false,
  );
  if (running || count <= 0) return null;
  const label = t("chat.backgroundSubagents", { count });
  return (
    <div className="background-delegations-chip" role="status" title={label}>
      <span className="background-delegations-dot" aria-hidden />
      {label}
    </div>
  );
}
