import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import WebSocket from "ws";
import { IPC, type AppSettings, type MobileGrant, type MobilePairing, type MobileRelayEnvelope, type MobileRelayTicket, type MobileSyncScope, type MobileSyncScopeInput, type MobileSyncSettings, type MobileSyncStatus } from "@pi-desktop/shared";
import type { AgentHost } from "@pi-desktop/agent-host";
import type { HostRpc } from "@pi-desktop/host-runtime";
import type { MirrorCodingAccount } from "../mirrorcoding/account";
import type { ImageService } from "../images/service";
import { MobilePeer } from "./peer";
import { MobileScopeAccess } from "./scope";
import { openMobileRelay } from "./transport";
import { object, string } from "./validation";

type Dependencies = {
  dataDir: string; account: MirrorCodingAccount; images: ImageService;
  host(): HostRpc; agent(): AgentHost;
  send(channel: string, state: unknown): void;
  log(message: string, error?: unknown): void;
};

/** Owns one outbound account connection and its explicitly authorized phone peers. */
export class MobileSyncService {
  private state: MobileSyncStatus = { status: "signed_out", pairings: [], grants: [] };
  private settings?: MobileSyncSettings;
  private scope: MobileScopeAccess;
  private socket?: WebSocket;
  private peers = new Map<string, { deviceId: string; peer: MobilePeer }>();
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private disposed = false;
  private started = false;
  private active = false;
  private epoch = 0;
  private refreshTask?: Promise<MobileSyncStatus>;
  private writes: Promise<unknown> = Promise.resolve();
  private incoming: Promise<void> = Promise.resolve();
  private receivedAt = Date.now();
  constructor(private deps: Dependencies) { this.scope = new MobileScopeAccess(deps.host); }
  status(): MobileSyncStatus { return structuredClone({ ...this.state, pairings: this.state.pairings.filter((pairing) => Date.parse(pairing.expiresAt) > Date.now()) }); }
  observeInvoke(channel: string) {
    if ([IPC.invoke.sessionConfigure, IPC.invoke.sessionMoveProject, IPC.invoke.projectGroupUpdate, IPC.invoke.projectGroupRename].some((value) => value === channel)) {
      for (const { peer } of this.peers.values()) peer.desktopChanged();
    }
  }
  private publish(patch: Partial<MobileSyncStatus> = {}) { this.state = { ...this.state, ...patch }; this.deps.send(IPC.event.mobileSyncChanged, this.status()); }
  async start() {
    this.started = true;
    const saved = (await this.deps.host().call<AppSettings>("settings.get")).mobileSync;
    this.active = !!saved?.scopes.length;
    if (this.active) void this.refresh(false);
    else this.publish({ status: this.deps.account.snapshot().status === "connected" ? "offline" : "signed_out" });
  }
  accountChanged() {
    if (!this.started || this.disposed) return;
    const account = this.deps.account.snapshot();
    if (account.status !== "connected" || String(account.account?.id ?? "") !== this.settings?.accountId) {
      this.epoch += 1; this.disconnect(); this.settings = undefined;
      this.publish({ status: "signed_out", deviceId: undefined, grants: [], pairings: [], error: undefined });
    }
    if (account.status === "connected" && account.account && this.active) void this.refresh(false);
  }
  async createPairing(input: MobileSyncScopeInput): Promise<MobilePairing> {
    const scope = await this.scope.resolve(input);
    await this.refresh();
    if (!this.settings || this.deps.account.snapshot().status !== "connected") throw new Error("mobile_login_required");
    await this.write(async () => {
      const settings = this.settings!;
      if (!settings.scopes.some((item) => sameScope(item, scope))) settings.scopes.push(scope);
      await this.persist();
    });
    const raw = await this.request("/pairings", { deviceId: this.settings.deviceId, scope });
    const row = object(object(raw).pairing);
    const pairing: MobilePairing = { id: string(row.id, "pairing_id"), code: string(row.code, "pairing_code"), expiresAt: string(row.expiresAt, "expires_at"), scope };
    this.publish({ pairings: [...this.state.pairings.filter((item) => !sameScope(item.scope, scope)), pairing] });
    return pairing;
  }
  async cancelPairing(id: string): Promise<MobileSyncStatus> {
    await this.request(`/pairings/${encodeURIComponent(id)}/cancel`, {});
    this.publish({ pairings: this.state.pairings.filter((item) => item.id !== id) });
    return this.status();
  }
  async revoke(id: string): Promise<MobileSyncStatus> {
    if (!this.settings || !this.state.grants.some((grant) => grant.id === id)) throw new Error("mobile_grant_not_found");
    await this.write(async () => { this.settings!.revokedGrantIds.push(id); await this.persist(); });
    this.publish({ grants: this.state.grants.filter((grant) => grant.id !== id) });
    this.reconcilePeers();
    try {
      await this.request(`/grants/${encodeURIComponent(id)}/revoke`, {});
      await this.write(async () => { if (this.settings) { this.settings.revokedGrantIds = this.settings.revokedGrantIds.filter((item) => item !== id); await this.persist(); } });
    } catch { this.publish({ error: "mobile_revoke_pending" }); }
    return this.status();
  }
  refresh(activate = true): Promise<MobileSyncStatus> {
    if (this.disposed) return Promise.resolve(this.status());
    this.active ||= activate;
    if (!this.active) return Promise.resolve(this.status());
    const epoch = this.epoch;
    return this.refreshTask ??= this.refreshOnce().finally(() => {
      this.refreshTask = undefined;
      if (epoch !== this.epoch && !this.disposed && this.active && this.deps.account.snapshot().status === "connected") void this.refresh(false);
    });
  }
  private async refreshOnce(): Promise<MobileSyncStatus> {
    const epoch = this.epoch;
    try {
      await this.deps.account.initialize();
      const account = this.deps.account.snapshot();
      if (account.status !== "connected" || !account.account) { this.publish({ status: "signed_out" }); return this.status(); }
      const accountId = String(account.account.id);
      if (!this.settings) {
        const saved = (await this.deps.host().call<AppSettings>("settings.get")).mobileSync;
        this.settings = saved?.accountId === accountId ? saved : { deviceId: randomUUID(), accountId, scopes: [], revokedGrantIds: [] };
        await this.persist();
      }
      this.publish({ status: this.socket?.readyState === WebSocket.OPEN ? "online" : "connecting", deviceId: this.settings.deviceId, error: undefined });
      const registration = object(await this.request("/devices/register", { deviceId: this.settings.deviceId, kind: "desktop", name: hostname() }));
      if (epoch !== this.epoch) return this.status();
      const deviceId = string(registration.deviceId, "device_id");
      if (deviceId !== this.settings.deviceId) { this.settings.deviceId = deviceId; await this.persist(); }
      for (const id of [...this.settings.revokedGrantIds]) {
        try { await this.request(`/grants/${encodeURIComponent(id)}/revoke`, {}); this.settings.revokedGrantIds = this.settings.revokedGrantIds.filter((item) => item !== id); await this.persist(); }
        catch { /* Keep the local denial and retry on the next connection. */ }
      }
      const result = object(await this.request(`/grants?deviceId=${encodeURIComponent(deviceId)}`));
      if (!Array.isArray(result.grants)) throw new Error("invalid_mobile_grants");
      const grants = result.grants.map(parseGrant).filter((grant) => this.accepts(grant));
      if (epoch !== this.epoch) return this.status();
      const priorIds = new Set(this.state.grants.map((grant) => grant.id));
      const consumed = grants.filter((grant) => !priorIds.has(grant.id));
      this.publish({ grants, pairings: this.state.pairings.filter((pairing) => !consumed.some((grant) => sameScope(grant.scope, pairing.scope))) }); this.reconcilePeers();
      if (!this.socket) {
        const data = object(await this.request("/relay/ticket", { deviceId }));
        const ticket: MobileRelayTicket = { ticket: string(data.ticket, "ticket"), url: string(data.url, "url"), expiresAt: string(data.expiresAt, "expires_at") };
        const socket = await openMobileRelay(ticket, this.deps.account.origin);
        if (epoch !== this.epoch || this.disposed) { socket.close(); return this.status(); }
        this.socket = socket;
        socket.on("open", () => { this.receivedAt = Date.now(); if (socket === this.socket) this.publish({ status: "online", deviceId, error: undefined }); });
        socket.on("message", (frame) => { this.receivedAt = Date.now(); this.incoming = this.incoming.then(async () => { if (socket === this.socket) await this.receive(frame.toString()); }).catch((error) => this.deps.log("mobile relay receive failed", error)); });
        socket.on("error", () => { if (socket === this.socket) this.publish({ status: "offline", error: "mobile_connection_failed" }); });
        socket.on("close", () => {
          if (socket !== this.socket) return;
          this.socket = undefined; this.closePeers(); this.publish({ status: "offline" }); this.schedule();
        });
        this.heartbeat ??= setInterval(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            if (Date.now() - this.receivedAt > 60_000) this.socket.terminate();
            else this.socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);
        this.heartbeat.unref();
      }
    } catch (error) {
      if (epoch === this.epoch) {
        const code = error instanceof Error ? error.message : "mobile_connection_failed";
        this.publish({ status: "error", error: code });
        if (code !== "mobile_service_unavailable") this.schedule();
      }
    }
    return this.status();
  }
  private async receive(frame: string) {
    try {
      const message = object(JSON.parse(frame));
      if (message.type === "ping") { this.send({ type: "pong" }); return; }
      if (message.type === "pong") return;
      if (message.type === "grants.changed") { await this.refresh(); return; }
      const peerId = string(message.peerId, "peer_id");
      if (message.type === "peer.close") { this.removePeer(peerId); return; }
      if (message.type === "peer.frame") { void this.peers.get(peerId)?.peer.frame(string(message.frame, "frame")); return; }
      if (message.type !== "peer.open") return;
      const accountId = string(message.accountId, "account_id");
      const deviceId = string(message.deviceId, "device_id");
      await this.refresh();
      if (accountId !== this.settings?.accountId || !this.grantsFor(deviceId).length) { this.send({ type: "peer.close", peerId, reason: "share_not_authorized" }); return; }
      this.removePeer(peerId);
      const peer = new MobilePeer({ ...this.deps, peerId, deviceId, desktopDeviceId: this.settings.deviceId, scope: this.scope,
        grants: () => this.grantsFor(deviceId), send: (value) => this.send({ type: "peer.frame", peerId, frame: value }),
        close: (reason) => { this.send({ type: "peer.close", peerId, reason }); this.removePeer(peerId); } });
      this.peers.set(peerId, { deviceId, peer });
    } catch (error) { this.deps.log("mobile relay frame rejected", error); }
  }
  private grantsFor(deviceId: string) { return this.state.grants.filter((grant) => grant.mobileDeviceId === deviceId && this.accepts(grant)); }
  private accepts(grant: MobileGrant) { return !!this.settings && grant.accountId === this.settings.accountId && grant.desktopDeviceId === this.settings.deviceId && !this.settings.revokedGrantIds.includes(grant.id) && this.settings.scopes.some((scope) => sameScope(scope, grant.scope)); }
  private reconcilePeers() { for (const [id, entry] of this.peers) if (!this.grantsFor(entry.deviceId).length) { this.send({ type: "peer.close", peerId: id, reason: "share_revoked" }); this.removePeer(id); } }
  private removePeer(id: string) { this.peers.get(id)?.peer.dispose(); this.peers.delete(id); }
  private closePeers() { for (const id of this.peers.keys()) this.removePeer(id); }
  private send(frame: MobileRelayEnvelope) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 8 * 1024 * 1024) { this.socket.close(1013, "resync_required"); return; }
    this.socket.send(JSON.stringify(frame));
  }
  private schedule() {
    if (this.disposed || this.timer || this.deps.account.snapshot().status !== "connected") return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 5_000); this.timer.unref();
  }
  private async request(path: string, data?: unknown): Promise<unknown> {
    const epoch = this.epoch;
    const response = await this.deps.account.request(`/api/pi-sync${path}`, { ...(data !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(20_000) });
    if (response.status === 404 || response.status === 501) throw new Error("mobile_service_unavailable");
    const body = object(await response.json());
    if (epoch !== this.epoch || this.disposed) throw new Error("mobile_account_changed");
    if (!response.ok || body.success !== true) { const error = body.error && typeof body.error === "object" ? object(body.error) : {}; throw new Error(typeof error.code === "string" ? error.code : "mobile_service_unavailable"); }
    return body.data;
  }
  private persist() { return this.deps.host().call("settings.set", { mobileSync: this.settings }); }
  private write(operation: () => Promise<void>) { const task = this.writes.then(operation); this.writes = task.catch(() => undefined); return task; }
  private disconnect() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined;
    const socket = this.socket; this.socket = undefined; socket?.close(); this.closePeers();
  }
  dispose() { this.disposed = true; this.epoch += 1; this.disconnect(); }
}

const sameScope = (left: MobileSyncScope, right: MobileSyncScope) => left.kind === right.kind && left.id === right.id;
function parseGrant(value: unknown): MobileGrant {
  const row = object(value); const scope = object(row.scope);
  if (scope.kind !== "project" && scope.kind !== "session") throw new Error("invalid_mobile_scope");
  return { id: string(row.id, "grant_id"), accountId: string(row.accountId, "account_id"), desktopDeviceId: string(row.desktopDeviceId, "desktop_device_id"), mobileDeviceId: string(row.mobileDeviceId, "mobile_device_id"), mobileDeviceName: string(row.mobileDeviceName, "mobile_device_name"), createdAt: string(row.createdAt, "created_at"), scope: { kind: scope.kind, id: string(scope.id, "scope_id"), label: string(scope.label, "scope_label") } };
}
