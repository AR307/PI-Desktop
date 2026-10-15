import type { SessionSummary } from "@pi-desktop/shared";
import {
  sessionIsArchived,
  type SessionMeta,
} from "./sidebar-preferences.ts";
import { sessionMatchesProject } from "./sidebar-session-groups.ts";

export type SessionScopeRow = Pick<
  SessionSummary,
  "id" | "projectPath" | "updatedAt" | "providerId" | "modelId"
>;

/** Newest non-archived session in the same project (or temporary) group. */
export function latestSessionInScope<T extends SessionScopeRow>(
  sessions: readonly T[],
  projectPath: string | null,
  sessionMeta: Record<string, SessionMeta>,
): T | undefined {
  return sessions
    .filter((session) => sessionMatchesProject(session, projectPath))
    .sort((a, b) => {
      const aUpdated = Date.parse(a.updatedAt);
      const bUpdated = Date.parse(b.updatedAt);
      const aTime = Number.isFinite(aUpdated) ? aUpdated : 0;
      const bTime = Number.isFinite(bUpdated) ? bUpdated : 0;
      return bTime - aTime || b.id.localeCompare(a.id);
    })
    .find((session) => !sessionIsArchived(session.id, sessionMeta));
}
