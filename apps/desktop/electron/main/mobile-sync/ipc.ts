import { IPC, type MobileSyncScopeInput } from "@pi-desktop/shared";
import { RacpError } from "@pi-desktop/agent-host";
import type { IpcRegistrar } from "../ipc/types";
import type { MobileSyncService } from "./service";
import { object, string } from "./validation";

export function registerMobileSyncIpc(
  registrar: IpcRegistrar,
  service: MobileSyncService,
): void {
  registrar.handle(IPC.invoke.mobileSyncStatus, async () => service.status());
  registrar.handle(IPC.invoke.mobileSyncRefresh, async () => service.refresh());
  registrar.handle(IPC.invoke.mobileSyncCancelPairing, async (id: unknown) =>
    service.cancelPairing(string(id, "pairing_id")),
  );
  registrar.handle(IPC.invoke.mobileSyncRevoke, async (id: unknown) =>
    service.revoke(string(id, "grant_id")),
  );
  registrar.handle(IPC.invoke.mobileSyncCreatePairing, async (input: unknown) => {
    const row = object(input);
    let scope: MobileSyncScopeInput;
    if (row.kind === "session") {
      scope = { kind: "session", sessionId: string(row.sessionId, "session_id") };
    } else if (row.kind === "project") {
      scope =
        typeof row.projectId === "string"
          ? { kind: "project", projectId: string(row.projectId, "project_id") }
          : { kind: "project", projectPath: string(row.projectPath, "project_path") };
    } else {
      throw new RacpError("INVALID_ARGUMENT", "invalid_mobile_scope");
    }
    return service.createPairing(scope);
  });
}
