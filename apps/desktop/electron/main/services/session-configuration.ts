import { EventEmitter } from "node:events";
import type { HostRpc } from "@pi-desktop/host-runtime";
import type { SessionConfigurationInput, SessionSummary, MobileSessionConfiguration } from "@pi-desktop/shared";

const changes = new EventEmitter();
const running = new WeakMap<HostRpc, Map<string, { turnId: string; configuration: MobileSessionConfiguration["next"] }>>();

/** Actual launch settings, shared across reconnecting peers; never re-read next-turn preferences. */
export function captureTurnConfiguration(host: HostRpc, sessionId: string, turnId: string, configuration: MobileSessionConfiguration["next"]): void {
  let sessions = running.get(host);
  if (!sessions) { sessions = new Map(); running.set(host, sessions); }
  sessions.set(sessionId, { turnId, configuration: { ...configuration } });
}

export function currentTurnConfiguration(host: HostRpc, sessionId: string): MobileSessionConfiguration["next"] | undefined {
  return running.get(host)?.get(sessionId)?.configuration;
}

export function releaseTurnConfiguration(host: HostRpc, sessionId: string, turnId: string): void {
  const sessions = running.get(host);
  if (sessions?.get(sessionId)?.turnId === turnId) sessions.delete(sessionId);
}

/** Rust serializes the partial update and persists model/Fast atomically. */
export async function configureSession(host: HostRpc, id: string, input: SessionConfigurationInput) {
  const result = await host.call<{ session?: SessionSummary | null }>("session.configure", { id, ...input });
  if (result.session) changes.emit("configured", result.session);
  return result;
}

export function onSessionConfigured(listener: (session: SessionSummary) => void): () => void {
  changes.on("configured", listener);
  return () => { changes.off("configured", listener); };
}
