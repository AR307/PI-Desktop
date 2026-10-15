export type SidebarSessionStatus =
  | "running"
  | "subagents"
  | "selected"
  | "completed"
  | "failed"
  | "permission";
export type SidebarSessionOutcome = Extract<
  SidebarSessionStatus,
  "completed" | "failed"
>;

export { latestSessionOutcomes } from "@pi-desktop/shared";

export function sidebarSessionStatus({
  running,
  selected,
  outcome,
  hasPendingPermission,
  backgroundDelegations,
}: {
  running: boolean;
  selected: boolean;
  outcome?: "completed" | "failed";
  hasPendingPermission?: boolean;
  /** Detached delegates still working while the session itself is idle (D628). */
  backgroundDelegations?: number;
}): SidebarSessionStatus | null {
  if (hasPendingPermission) return "permission";
  if (running) return "running";
  if ((backgroundDelegations ?? 0) > 0) return "subagents";
  if (selected) return "selected";
  return outcome ?? null;
}
