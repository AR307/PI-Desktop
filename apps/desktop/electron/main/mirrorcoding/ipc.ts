import { IPC } from "@pi-desktop/shared";
import type { IpcRegistrar } from "../ipc/types";
import type { MirrorCodingRuntime } from "./runtime";

export function registerMirrorCodingIpc({ registrar, runtime, activeTurns, abort }: {
  registrar: IpcRegistrar;
  runtime: MirrorCodingRuntime;
  activeTurns: Map<string, string>;
  abort(sessionId: string): Promise<unknown>;
}): void {
  const handle = (channel: string, fn: (confirmed: boolean) => Promise<unknown>) => {
    registrar.handleWithEvent(channel, async (event, confirmed?: unknown) => {
      registrar.assertMainWindowSender(event);
      return fn(confirmed === true);
    });
  };
  const prepare = async (confirmed: boolean): Promise<boolean> => {
    const running = runtime.relay.boundSessions().filter((id) => activeTurns.has(id));
    if ((running.length || runtime.images.hasJobs() || runtime.relay.hasActiveRequests()) && !confirmed) return false;
    await Promise.all(running.map(abort));
    runtime.images.dispose();
    runtime.relay.invalidate();
    return true;
  };
  handle(IPC.invoke.mirrorCodingGetState, async () => { await runtime.account.initialize(); return runtime.account.snapshot(); });
  handle(IPC.invoke.mirrorCodingLogin, async (confirmed) => {
    if (!await prepare(confirmed)) return { confirmationRequired: true };
    return { state: await runtime.account.startLogin() };
  });
  handle(IPC.invoke.mirrorCodingCancelLogin, async () => runtime.account.cancelLogin());
  handle(IPC.invoke.mirrorCodingRefresh, async () => { await runtime.account.refreshCatalog(); return runtime.account.snapshot(); });
  handle(IPC.invoke.mirrorCodingLogout, async (confirmed) => {
    if (!await prepare(confirmed)) return { confirmationRequired: true };
    return { state: await runtime.account.logout() };
  });
  handle(IPC.invoke.mirrorCodingRetryRevocation, async () => { await runtime.account.retryRevocation(); return runtime.account.snapshot(); });
  handle(IPC.invoke.mirrorCodingCompleteWelcome, async () => { await runtime.completeWelcome(); return { ok: true }; });
}
