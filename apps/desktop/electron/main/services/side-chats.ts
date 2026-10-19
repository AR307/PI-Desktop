import { shell } from "electron";
import type { SessionSummary } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { AgentIpcDependencies } from "../ipc/agent-ipc";

const initialized = new WeakMap<HostProcess, Promise<void>>();
const closing = new Set<string>();
const closeOperations = new Map<string, Promise<{ ok: boolean }>>();
const queueSubmissions = new Map<string, Set<Promise<unknown>>>();

export function assertSideChatOpen(id: string): void {
  if (closing.has(id)) throw new Error("Side chat is closing");
}

/** Queue admission can call prompt itself, so never hold the prompt lock here. */
export async function submitSideChatQueue<T>(id: string, submit: () => Promise<T>): Promise<T> {
  assertSideChatOpen(id);
  if (!id.startsWith("side-")) return submit();
  const pending = queueSubmissions.get(id) ?? new Set<Promise<unknown>>();
  const operation = submit();
  pending.add(operation);
  queueSubmissions.set(id, pending);
  try {
    return await operation;
  } finally {
    pending.delete(operation);
    if (!pending.size) queueSubmissions.delete(id);
  }
}

async function recycleAndClose(host: HostProcess, sessionId: string): Promise<void> {
  const { paths } = await host.call<{ paths: string[] }>("sideChat.cleanupPaths", { sessionId });
  for (const path of paths) await shell.trashItem(path);
  await host.call("sideChat.close", { sessionId });
}

/** Run once per Host process, before its first history listing or side open. */
export function clearStaleSideChats(host: HostProcess): Promise<void> {
  let pending = initialized.get(host);
  if (!pending) {
    pending = (async () => {
      const { ids } = await host.call<{ ids: string[] }>("sideChat.list");
      for (const id of ids) await recycleAndClose(host, id);
    })();
    initialized.set(host, pending);
    void pending.catch(() => initialized.delete(host));
  }
  return pending;
}

export function createSideChatService(
  deps: Pick<
    AgentIpcDependencies,
    | "getHost"
    | "getSidecar"
    | "getAgentHostBridge"
    | "acquireSessionOperation"
    | "resolveAgentRuntimeLaunch"
    | "cancelSessionTools"
    | "agentExtensions"
    | "activeTurns"
    | "finishTurn"
    | "lockAbortReason"
    | "persistenceOutbox"
  >,
) {
  return {
    async open(parentSessionId: string): Promise<{ session: SessionSummary }> {
      const host = deps.getHost();
      const sidecar = deps.getSidecar();
      if (!host || !sidecar) throw new Error("Backend unavailable");
      if (
        !parentSessionId ||
        parentSessionId.startsWith("side-") ||
        parentSessionId.startsWith("remote:") ||
        parentSessionId.startsWith("native-pi:")
      )
        throw new Error("A local parent conversation is required");
      await clearStaleSideChats(host);
      const release = await deps.acquireSessionOperation(parentSessionId);
      try {
        await deps.persistenceOutbox.flush(() => host);
        const [{ session: parent }, settings] = await Promise.all([
          host.call<{ session: SessionSummary }>("session.get", {
            id: parentSessionId,
            messageLimit: 1,
          }),
          host.call("settings.get"),
        ]);
        if (!parent) throw new Error("Parent conversation not found");
        const result = await host.call<{
          session: SessionSummary;
          workspacePath: string;
          created: boolean;
        }>("sideChat.open", { parentSessionId });
        const releaseChild = await deps.acquireSessionOperation(result.session.id);
        try {
          assertSideChatOpen(result.session.id);
          const info = await host.call<{ workspacePath: string | null }>("sideChat.info", {
            sessionId: result.session.id,
          });
          if (!info.workspacePath) throw new Error("Side chat was closed while opening");
          const parentLaunch = await deps.resolveAgentRuntimeLaunch(parent.id, parent, settings, {
            fast: parent.fast === true,
            ultra: parent.ultra === true,
          });
          if (result.created) {
            const configured = await host.call<{ session: SessionSummary }>("session.configure", {
              id: result.session.id,
              mode: parentLaunch.sidecarParams.mode,
              providerId: parentLaunch.providerId,
              modelId: parentLaunch.modelId,
              thinkingLevel: parentLaunch.sidecarParams.thinkingLevel,
            });
            result.session = configured.session;
          }
          const childLaunch = await deps.resolveAgentRuntimeLaunch(
            result.session.id,
            result.session,
            settings,
            { fast: result.session.fast === true, ultra: result.session.ultra === true },
          );
          await sidecar.call("agent.openSideChat", {
            parent: parentLaunch.sidecarParams,
            child: childLaunch.sidecarParams,
          });
          return {
            session: {
              ...result.session,
              sideChatParentId: parentSessionId,
              sideChatWorkspacePath: result.workspacePath,
            },
          };
        } catch (error) {
          if (result.created) {
            try {
              await sidecar.call("agent.disposeSession", { sessionId: result.session.id });
              await deps.persistenceOutbox.dropSession(result.session.id);
              sidecar.clearProjectInstructionRoot(result.session.id);
              sidecar.clearVendorAuthBindings(result.session.id);
              await recycleAndClose(host, result.session.id);
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                "Side chat failed to open and could not be cleaned up",
              );
            }
          }
          throw error;
        } finally {
          releaseChild();
        }
      } finally {
        release();
      }
    },
    async close(sessionId: string): Promise<{ ok: boolean }> {
      const pending = closeOperations.get(sessionId);
      if (pending) return pending;
      const operation = closeSession(sessionId);
      closeOperations.set(sessionId, operation);
      try {
        return await operation;
      } finally {
        closeOperations.delete(sessionId);
        closing.delete(sessionId);
      }
    },
  };
  async function closeSession(sessionId: string): Promise<{ ok: boolean }> {
    const host = deps.getHost();
    const sidecar = deps.getSidecar();
    if (!host || !sidecar) throw new Error("Backend unavailable");
    if (!sessionId.startsWith("side-")) throw new Error("Not a temporary side chat");
    closing.add(sessionId);
    await Promise.allSettled([...(queueSubmissions.get(sessionId) ?? [])]);
    const bridge = deps.getAgentHostBridge();
    await bridge?.queue.clearSession(sessionId);
    const release = await deps.acquireSessionOperation(sessionId);
    try {
      const turnId = deps.activeTurns.get(sessionId);
      deps.lockAbortReason(sessionId, turnId);
      deps.agentExtensions.cancelPrompts(sessionId);
      deps.cancelSessionTools(sessionId, "Side chat closed");
      await sidecar.call("agent.disposeSession", { sessionId });
      if (turnId) await deps.finishTurn(sessionId, "aborted", "TURN_ABORTED", { turnId });
      await bridge?.queue.clearSession(sessionId);
      await bridge?.releaseSession(sessionId);
      await deps.persistenceOutbox.dropSession(sessionId);
      sidecar.clearProjectInstructionRoot(sessionId);
      sidecar.clearVendorAuthBindings(sessionId);
      await recycleAndClose(host, sessionId);
      return { ok: true };
    } finally {
      release();
    }
  }
}
