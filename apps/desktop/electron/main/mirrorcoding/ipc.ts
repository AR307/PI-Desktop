import { IPC, type AgentEventEnvelope, type ImageGenerationRequest, type UiMessage } from "@pi-desktop/shared";
import type { IpcRegistrar } from "../ipc/types";
import type { MirrorCodingRuntime } from "./runtime";

export function registerMirrorCodingIpc({ registrar, runtime, activeTurns, abort, emitAgentEvent }: {
  registrar: IpcRegistrar;
  runtime: MirrorCodingRuntime;
  activeTurns: Map<string, string>;
  abort(sessionId: string): Promise<unknown>;
  emitAgentEvent: (envelope: AgentEventEnvelope) => void;
}): void {
  const handle = (channel: string, fn: (confirmed: boolean) => Promise<unknown>) => {
    registrar.handleWithEvent(channel, async (event, confirmed?: unknown) => {
      registrar.assertMainWindowSender(event);
      return fn(confirmed === true);
    });
  };
  const prepare = async (confirmed: boolean): Promise<boolean> => {
    const running = runtime.relay.boundSessions().filter((id) => activeTurns.has(id));
    if ((running.length || runtime.relay.hasActiveRequests()) && !confirmed) return false;
    await Promise.all(running.map(abort));
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
  registrar.handleWithEvent(IPC.invoke.imageGenerate, async (event, input: unknown) => {
    registrar.assertMainWindowSender(event);
    if (!input || typeof input !== "object") throw new Error("invalid_image_request");
    const request = input as ImageGenerationRequest;
    if (!request.sessionId || !request.providerId || !request.modelId || !request.prompt.trim()) {
      throw new Error("invalid_image_request");
    }
    const execution = await runtime.generateImage(request);
    for (const message of [execution.userMessage, execution.assistantMessage]) {
      registrarImageMessage(emitAgentEvent, request.sessionId, execution.turnId, message);
    }
    return { jobId: execution.jobId, result: execution.result };
  });
  registrar.handleWithEvent(IPC.invoke.imageAbort, async (event, jobId: unknown) => {
    registrar.assertMainWindowSender(event);
    if (typeof jobId !== "string" || !jobId.trim()) throw new Error("invalid_image_job");
    return { aborted: runtime.abortImage(jobId) };
  });
}

function registrarImageMessage(
  emit: (envelope: AgentEventEnvelope) => void,
  sessionId: string,
  turnId: string,
  message: UiMessage,
): void {
  emit({ sessionId, turnId, ts: Date.now(), event: { type: "message_start", message } });
  emit({ sessionId, turnId, ts: Date.now(), event: { type: "message_end", message } });
}
