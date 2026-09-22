import { RacpError } from "@pi-desktop/agent-host";
import type { HostRpc } from "@pi-desktop/host-runtime";
import type { MobileGrant, MobileSyncScope, MobileSyncScopeInput, ProjectGroupRecord, SessionSummary, SessionDetail } from "@pi-desktop/shared";

const pathKey = (value?: string) => {
  const normalized = (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

/** Resolves membership from current host metadata, including newly created sessions. */
export class MobileScopeAccess {
  constructor(private host: () => HostRpc) {}
  async groups(): Promise<ProjectGroupRecord[]> {
    const result = await this.host().call<{ groups: ProjectGroupRecord[] }>("project.groups.list");
    return result.groups;
  }
  async resolve(input: MobileSyncScopeInput): Promise<MobileSyncScope> {
    if (input.kind === "session") {
      const { session } = await this.host().call<{ session?: SessionDetail }>("session.get", { id: input.sessionId, messageLimit: 1 });
      if (!session) throw new RacpError("NOT_FOUND", "session_not_found");
      return { kind: "session", id: session.id, label: session.title || "Untitled" };
    }
    const group = (await this.groups()).find((item) => "projectId" in input ? item.id === input.projectId : item.roots.some((root) => pathKey(root.path) === pathKey(input.projectPath)));
    if (!group) throw new RacpError("NOT_FOUND", "project_not_found");
    return { kind: "project", id: group.id, label: group.name };
  }
  async sessions(grants: MobileGrant[]): Promise<SessionSummary[]> {
    if (!grants.length) return [];
    const [result, groups] = await Promise.all([
      this.host().call<{ sessions: SessionSummary[] }>("session.list"), this.groups(),
    ]);
    const ids = new Set(grants.filter((grant) => grant.scope.kind === "session").map((grant) => grant.scope.id));
    const groupIds = new Set(grants.filter((grant) => grant.scope.kind === "project").map((grant) => grant.scope.id));
    const roots = new Set(groups.filter((group) => groupIds.has(group.id)).flatMap((group) => group.roots.map((root) => pathKey(root.path))));
    return result.sessions.filter((session) => ids.has(session.id) || (session.projectPath && roots.has(pathKey(session.projectPath))));
  }
  async require(sessionId: string, grants: MobileGrant[]): Promise<SessionSummary> {
    const explicit = grants.some((grant) => grant.scope.kind === "session" && grant.scope.id === sessionId);
    const projectIds = new Set(grants.filter((grant) => grant.scope.kind === "project").map((grant) => grant.scope.id));
    if (!explicit && !projectIds.size) throw new RacpError("FORBIDDEN", "session_not_shared");
    const { session } = await this.host().call<{ session?: SessionDetail }>("session.get", { id: sessionId, messageLimit: 1, contentLimit: 1 });
    if (!session) throw new RacpError("FORBIDDEN", "session_not_shared");
    if (!explicit) {
      const groups = await this.groups();
      const member = session.projectPath && groups.some((group) => projectIds.has(group.id) && group.roots.some((root) => pathKey(root.path) === pathKey(session.projectPath)));
      if (!member) throw new RacpError("FORBIDDEN", "session_not_shared");
    }
    return session;
  }
}
