import { IPC, type MobileSyncScopeInput } from "@pi-desktop/shared";
import type { IpcRegistrar } from "../ipc/types";
import type { MobileSyncService } from "./service";
import { object, string } from "./validation";

export function registerMobileSyncIpc(registrar: IpcRegistrar, service: MobileSyncService) {
  registrar.handle(IPC.invoke.mobileSyncStatus, async () => service.status());
  registrar.handle(IPC.invoke.mobileSyncRefresh, async () => service.refresh());
  registrar.handle(IPC.invoke.mobileSyncCancelPairing, async (id: unknown) => service.cancelPairing(string(id, "pairing_id")));
  registrar.handle(IPC.invoke.mobileSyncRevoke, async (id: unknown) => service.revoke(string(id, "grant_id")));
  registrar.handle(IPC.invoke.mobileSyncCreatePairing, async (input: unknown) => {
    const row = object(input);
    const scope: MobileSyncScopeInput = row.kind === "session"
      ? { kind: "session", sessionId: string(row.sessionId, "session_id") }
      : row.kind === "project"
        ? typeof row.projectId === "string" ? { kind: "project", projectId: row.projectId } : { kind: "project", projectPath: string(row.projectPath, "project_path") }
        : (() => { throw new Error("invalid_mobile_scope"); })();
    return service.createPairing(scope);
  });
}
