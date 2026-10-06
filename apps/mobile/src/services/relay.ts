import { RacpClient, type ClientTransport, type RacpClientState } from "@pi-desktop/racp/client";
import { APP_VERSION } from "@pi-desktop/shared";
import type { MobileDirectoryPage, MobileSessionChangesPage, MobileSessionHistoryPage, MobileModelCatalog, MobileSession, MobileSessionConfiguration, MobileSessionSnapshot, MobileSessionState, RacpCursor, RacpEventEnvelope, MobileSessionConfigureInput, UiMessage } from "@pi-desktop/shared";
import type { MobileAccount } from "./account";
import { AccountError } from "./account";

type RelayUnavailableReason = "DESKTOP_OFFLINE" | "GRANT_REVOKED" | "AUTH_EXPIRED";
function unavailableReason(value: string): RelayUnavailableReason | undefined {
  return value === "DESKTOP_OFFLINE" || value === "GRANT_REVOKED" || value === "AUTH_EXPIRED" ? value : undefined;
}

export type RelayObserver = {
  event(event: RacpEventEnvelope): void;
  state(state: RacpClientState): void;
  restored(): Promise<void>;
  error(error: unknown): void;
  directoryChanged?(): void;
  accountChanged?(): void;
  unavailable(reason: RelayUnavailableReason): void;
};

/**
 * Cached sessions attach with live state and durable changes. Only an uncached
 * session downloads its first history page; cursor expiry does not replace it.
 */
export type MobileAttachResult =
  | { kind: "state"; state: MobileSessionState }
  | { kind: "snapshot"; snapshot: MobileSessionSnapshot };

async function browserTransport(account: MobileAccount, desktopId: string): Promise<ClientTransport> {
  const ticket = await account.ticket(desktopId);
  const url = new URL(ticket.url, account.origin);
  if (!((url.protocol === "wss:" && url.host === new URL(account.origin).host) || (new URL(account.origin).protocol === "http:" && url.protocol === "ws:" && url.host === new URL(account.origin).host))) {
    throw new Error("Invalid relay URL");
  }
  url.searchParams.set("ticket", ticket.ticket);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Relay connection timed out")); }, 20_000);
    socket.onopen = () => {
      clearTimeout(timeout);
      resolve({
        send(frame) { socket.send(frame); },
        close(code, reason) { socket.close(code, reason); },
        onMessage(handler) { socket.onmessage = (event) => { if (typeof event.data === "string") handler(event.data); }; },
        onClose(handler) { socket.onclose = (event) => handler({ code: event.code, reason: event.reason }); },
        onError(handler) { socket.onerror = () => handler(new Error("Relay disconnected")); },
      });
    };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error("Relay connection failed")); };
    socket.onclose = (event) => {
      clearTimeout(timeout);
      const reason = unavailableReason(event.reason);
      reject(reason ? new AccountError(reason, reason) : new Error("Relay connection closed"));
    };
  });
}

export class MobileRelay {
  readonly client: RacpClient;
  private subscriptionId?: string;
  private attaching: Promise<unknown> = Promise.resolve();
  private transport?: ClientTransport;
  private closed = false;
  constructor(account: MobileAccount, desktopId: string, observer: RelayObserver) {
    this.client = new RacpClient({
      transport: async () => {
        let transport: ClientTransport;
        try { transport = await browserTransport(account, desktopId); }
        catch (error) {
          const reason = error instanceof AccountError ? unavailableReason(error.code === "UNAUTHORIZED" ? "AUTH_EXPIRED" : error.code) : undefined;
          if (!this.closed && reason) observer.unavailable(reason);
          throw error;
        }
        if (this.closed) { transport.close(); throw new Error("Mobile relay closed"); }
        this.transport = transport;
        return {
          ...transport,
          onClose: (handler) => transport.onClose((info) => {
            const reason = unavailableReason(info.reason);
            if (!this.closed && reason) observer.unavailable(reason);
            else handler(info);
          }),
        };
      },
      client: { name: "pi-mobile", version: APP_VERSION },
      reconnect: { enabled: true, baseDelayMs: 800, maxDelayMs: 15_000 },
      onEvent: (event) => {
        observer.event(event);
        if (event.sequence !== undefined && this.subscriptionId) void this.request("events/ack", { subscriptionId: this.subscriptionId, sequence: event.sequence }).catch(observer.error);
      }, onStateChange: observer.state, onReconnected: async () => { this.subscriptionId = undefined; await observer.restored(); },
      onSubscriptionClosed: () => { void observer.restored().catch(observer.error); },
      onNotification: (method) => {
        if (method === "mobile.directoryChanged") observer.directoryChanged?.();
        else if (method === "mobile.devicesChanged" || method === "mobile.grantsChanged") observer.accountChanged?.();
      },
    });
  }
  connect() { return this.client.connect(); }
  close() { this.closed = true; this.subscriptionId = undefined; return this.client.close(); }
  /** Server capability flags from `connection/initialize`; old desktops omit them. */
  get supportsSessionState(): boolean { return this.client.initialized?.capabilities?.sessionState === true; }
  get supportsItemContent(): boolean { return this.client.initialized?.capabilities?.itemContent === true; }
  async request<T>(method: string, params?: unknown): Promise<T> {
    const transport = this.transport;
    try { return await this.client.request<T>(method, params); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "TIMEOUT" && transport === this.transport) transport?.close(4000, "request timed out");
      throw error;
    }
  }
  async sessions(grantId: string): Promise<MobileSession[]> { return (await this.request<{ sessions: MobileSession[] }>("session/list", { grantId })).sessions; }
  async directory(): Promise<MobileDirectoryPage> {
    const result: MobileDirectoryPage = { desktopDeviceId: "", projects: [], sessions: [], generatedAt: "" };
    let cursor: string | undefined;
    do {
      const page = await this.request<MobileDirectoryPage>("directory/list", { cursor, limit: 100 });
      result.desktopDeviceId = page.desktopDeviceId;
      result.projects = page.projects;
      result.sessions.push(...page.sessions);
      result.generatedAt = page.generatedAt;
      cursor = page.nextCursor;
    } while (cursor);
    return result;
  }
  watchDirectory() { return this.request("directory/subscribe", {}); }
  async detach(): Promise<void> {
    if (!this.subscriptionId) return;
    const subscriptionId = this.subscriptionId;
    this.subscriptionId = undefined;
    if (this.client.state === "connected") await this.request("events/unsubscribe", { subscriptionId });
  }
  attach(sessionId: string, after?: RacpCursor): Promise<MobileAttachResult> {
    const next = this.attaching.then(() => this.attachNow(sessionId, after));
    this.attaching = next.then(() => undefined, () => undefined);
    return next;
  }
  private async attachNow(sessionId: string, after?: RacpCursor): Promise<MobileAttachResult> {
    await this.detach();
    const light = after !== undefined;
    const reply = await this.request<{ snapshot?: MobileSessionSnapshot; state?: MobileSessionState }>(
      "session/attach",
      { sessionId, includeSnapshot: !light, role: "controller" },
    );
    if (reply.state && light) {
      const subscription = await this.request<{ subscriptionId: string; replayComplete?: boolean }>(
        "events/subscribe",
        { scope: "session", sessionId, after: reply.state.cursor },
      );
      this.subscriptionId = subscription.subscriptionId;
      return { kind: "state", state: reply.state };
    }
    if (light) throw new Error("Mobile sync requires the updated desktop protocol");
    const snapshot = reply.snapshot ?? (await this.snapshot(sessionId));
    const subscription = await this.request<{ subscriptionId: string }>("events/subscribe", { scope: "session", sessionId, after: snapshot.cursor });
    this.subscriptionId = subscription.subscriptionId;
    return { kind: "snapshot", snapshot };
  }
  snapshot(sessionId: string) { return this.request<{ snapshot: MobileSessionSnapshot }>("session/snapshot", { sessionId }).then((value) => value.snapshot); }
  /** Light refresh: the snapshot minus its transcript page. */
  state(sessionId: string) { return this.request<{ state: MobileSessionState }>("session/state", { sessionId }).then((value) => value.state); }
  modelCatalog(sessionId: string) { return this.request<{ catalog: MobileModelCatalog }>("session/modelCatalog", { sessionId }).then((value) => value.catalog); }
  configure(sessionId: string, input: MobileSessionConfigureInput) {
    return this.request<{ session: MobileSession & { configuration?: MobileSessionConfiguration } }>("session/configure", { sessionId, ...input, context: { requestId: crypto.randomUUID() } }).then((value) => value.session);
  }
  history(sessionId: string, beforeItemId: string) {
    return this.request<MobileSessionHistoryPage>("session/history", { sessionId, beforeItemId, limit: 50 });
  }
  changes(sessionId: string, afterRevision: number) { return this.request<MobileSessionChangesPage>("session/changes", { sessionId, afterRevision, limit: 50 }); }
  /** Reassemble one item's complete JSON from relay-safe chunks. */
  async item(sessionId: string, itemId: string): Promise<UiMessage> {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<{ data: string; nextOffset: number; size: number; eof: boolean }>(
        "session/item",
        { sessionId, itemId, offset },
      );
      const binary = atob(page.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      chunks.push(bytes);
      offset = page.nextOffset;
      if (page.eof) break;
    }
    const payload = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let position = 0;
    for (const chunk of chunks) { payload.set(chunk, position); position += chunk.length; }
    return JSON.parse(new TextDecoder().decode(payload)) as UiMessage;
  }
}
