import { dialog } from "electron";
import { IPC, validateCodexImportRequest } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { IpcRegistrar } from "./types";
let hiddenThisRun = false;

export function registerCodexImportIpc({ registrar, getHost }: {
  registrar: IpcRegistrar; getHost: () => HostProcess | null;
}): void {
  registrar.handle(IPC.invoke.codexImportHint, async (input: unknown = {}) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hint request");
    if ("hidden" in input && input.hidden !== undefined) {
      if (typeof input.hidden !== "boolean") throw new Error("Invalid hint preference");
      hiddenThisRun = input.hidden;
    }
    return { hidden: hiddenThisRun };
  });
  for (const [channel, kind] of [
    [IPC.invoke.codexImportScan, "scan"],
    [IPC.invoke.codexImportPage, "page"],
    [IPC.invoke.codexImportRun, "run"],
    [IPC.invoke.codexImportCancel, "cancel"],
  ] as const) {
    registrar.handle(channel, async (input: unknown = {}) => {
      validateCodexImportRequest(kind, input);
      const host = getHost();
      if (!host) throw new Error("Host unavailable");
      return host.call(`codex.import.${kind}`, input, 300_000);
    });
  }
  registrar.handle(IPC.invoke.codexImportChoose, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}
