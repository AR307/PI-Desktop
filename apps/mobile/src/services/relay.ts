import { RacpClient, type ClientTransport, type RacpClientState } from "@pi-desktop/racp/client";
import type { MobileModelCatalog, MobileSession, MobileSessionConfiguration, MobileSessionSnapshot, RacpEventEnvelope, RacpItemSummary, MobileSessionConfigureInput } from "@pi-desktop/shared";
import type { MobileAccount } from "./account";

export type RelayObserver = {
  event(event: RacpEventEnvelope): void;
  state(state: RacpClientState): void;
  restored(): Promise<void>;
  error(error: unknown): void;
};

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
    socket.onclose = () => { clearTimeout(timeout); reject(new Error("Desktop offline")); };
  });
}

export class MobileRelay {
  readonly client: RacpClient;
  private subscriptionId?: string;
  private attaching: Promise<unknown> = Promise.resolve();
  private transport?: ClientTransport;
  constructor(account: MobileAccount, desktopId: string, observer: RelayObserver) {
    this.client = new RacpClient({
      transport: async () => { const transport = await browserTransport(account, desktopId); this.transport = transport; return transport; },
      client: { name: "pi-mobile", version: "0.15.1" },
      reconnect: { enabled: true, baseDelayMs: 800, maxDelayMs: 15_000 },
      onEvent: (event) => {
        observer.event(event);
        if (event.sequence !== undefined && this.subscriptionId) void this.request("events/ack", { subscriptionId: this.subscriptionId, sequence: event.sequence }).catch(observer.error);
      }, onStateChange: observer.state, onReconnected: async () => { this.subscriptionId = undefined; await observer.restored(); },
      onSubscriptionClosed: () => { void observer.restored().catch(observer.error); },
    });
  }
  connect() { return this.client.connect(); }
  close() { return this.client.close(); }
  async request<T>(method: string, params?: unknown): Promise<T> {
    const transport = this.transport;
    try { return await this.client.request<T>(method, params); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "TIMEOUT" && transport === this.transport) transport?.close(4000, "request timed out");
      throw error;
    }
  }
  async sessions(grantId: string): Promise<MobileSession[]> { return (await this.request<{ sessions: MobileSession[] }>("session/list", { grantId })).sessions; }
  attach(sessionId: string): Promise<MobileSessionSnapshot> {
    const next = this.attaching.then(() => this.attachNow(sessionId));
    this.attaching = next.then(() => undefined, () => undefined);
    return next;
  }
  private async attachNow(sessionId: string): Promise<MobileSessionSnapshot> {
    if (this.subscriptionId) {
      await this.request("events/unsubscribe", { subscriptionId: this.subscriptionId });
      this.subscriptionId = undefined;
    }
    const { snapshot } = await this.request<{ snapshot: MobileSessionSnapshot }>("session/attach", { sessionId, includeSnapshot: true, role: "controller" });
    const subscription = await this.request<{ subscriptionId: string }>("events/subscribe", { scope: "session", sessionId, after: snapshot.cursor });
    this.subscriptionId = subscription.subscriptionId;
    return snapshot;
  }
  snapshot(sessionId: string) { return this.request<{ snapshot: MobileSessionSnapshot }>("session/snapshot", { sessionId }).then((value) => value.snapshot); }
  modelCatalog(sessionId: string) { return this.request<{ catalog: MobileModelCatalog }>("session/modelCatalog", { sessionId }).then((value) => value.catalog); }
  configure(sessionId: string, input: MobileSessionConfigureInput) {
    return this.request<{ session: MobileSession & { configuration?: MobileSessionConfiguration } }>("session/configure", { sessionId, ...input, context: { requestId: crypto.randomUUID() } }).then((value) => value.session);
  }
  history(sessionId: string, beforeItemId: string) {
    return this.request<{ items: RacpItemSummary[]; hasMore: boolean; revision: number }>("session/history", { sessionId, beforeItemId, limit: 50 });
  }
}
