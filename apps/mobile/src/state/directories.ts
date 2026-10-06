import type { RacpClientState } from "@pi-desktop/racp/client";
import type { MobileDirectoryPage, MobileGrant, RacpEventEnvelope } from "@pi-desktop/shared";
import type { MobileAccount, MobileDevice } from "../services/account";
import { readDirectory, saveDirectory } from "../services/account-cache";
import { clearDesktopCache } from "../services/mobile-db";
import { MobileRelay } from "../services/relay";
import { TranscriptCache } from "../services/transcript-cache";

export type DesktopDirectory = MobileDirectoryPage & {
  device: MobileDevice;
  grants: MobileGrant[];
  connection: RacpClientState;
};
type DirectoryObserver = {
  changed(rows: DesktopDirectory[]): void;
  event(desktopId: string, event: RacpEventEnvelope): void;
  restored(desktopId: string): Promise<void>;
  accountChanged(): void;
  removing(desktopId: string, sessionIds?: string[]): Promise<void>;
  error(error: unknown): void;
};

export function grantsForDesktop(grants: MobileGrant[], device: MobileDevice): MobileGrant[] {
  return grants.filter((grant) => grant.scope.kind === "account"
    ? device.accountSyncEnabled === true
    : grant.desktopDeviceId === device.deviceId);
}

function restrictDirectory(row: DesktopDirectory): DesktopDirectory {
  if (row.grants.some((grant) => grant.scope.kind === "account")) return row;
  const projectIds = new Set(row.grants.filter((grant) => grant.scope.kind === "project").map((grant) => grant.scope.id));
  const sessionIds = new Set(row.grants.filter((grant) => grant.scope.kind === "session").map((grant) => grant.scope.id));
  const sessions = row.sessions.filter((session) => sessionIds.has(session.id) || projectIds.has(session.projectId ?? ""));
  const projects = row.projects.filter((project) => projectIds.has(project.id) || sessions.some((session) => session.projectId === project.id));
  return { ...row, sessions, projects };
}

/** One relay per authorized computer; only the selected conversation has a content subscription. */
export class MobileDirectories {
  private rows = new Map<string, DesktopDirectory>();
  private relays = new Map<string, MobileRelay>();
  private jobs = new Map<string, Promise<void>>();
  private refreshAgain = new Set<string>();
  private generation = 0;
  constructor(private account: MobileAccount, private observer: DirectoryObserver) {}
  relay(id: string) { return this.relays.get(id); }
  row(id: string) { return this.rows.get(id); }
  private emit() { this.observer.changed([...this.rows.values()]); }

  async restore(grants: MobileGrant[], devices: MobileDevice[]): Promise<void> {
    const generation = this.generation;
    const accountId = this.account.session?.account.id;
    if (!accountId) return;
    for (const device of devices.filter((device) => device.kind === "desktop")) {
      const permitted = grantsForDesktop(grants, device);
      if (!permitted.length) continue;
      const cached = await readDirectory(accountId, device.deviceId);
      if (generation !== this.generation || this.account.session?.account.id !== accountId) return;
      this.rows.set(device.deviceId, restrictDirectory({
        desktopDeviceId: device.deviceId, projects: [], sessions: [], generatedAt: "", ...cached,
        device: { ...device, online: false }, grants: permitted, connection: "disconnected",
      }));
    }
    this.emit();
  }

  async sync(grants: MobileGrant[], devices: MobileDevice[]): Promise<void> {
    const generation = this.generation;
    const accountId = this.account.session?.account.id;
    if (!accountId) return;
    const available = devices.filter((device) => device.kind === "desktop" && grantsForDesktop(grants, device).length);
    for (const [id] of this.rows) {
      if (available.some((device) => device.deviceId === id)) continue;
      const relay = this.relays.get(id);
      this.relays.delete(id); this.rows.delete(id);
      await this.observer.removing(id);
      await relay?.close();
      await clearDesktopCache(accountId, id);
    }
    for (const device of available) {
      if (generation !== this.generation) return;
      const previous = this.rows.get(device.deviceId);
      this.rows.set(device.deviceId, {
        desktopDeviceId: device.deviceId, projects: [], sessions: [], generatedAt: "", ...previous,
        device, grants: grantsForDesktop(grants, device), connection: previous?.connection ?? "disconnected",
      });
      // A narrower remaining grant must immediately remove cached sibling sessions,
      // even when this computer is currently offline.
      const row = this.rows.get(device.deviceId)!;
      if (!row.grants.some((grant) => grant.scope.kind === "account")) {
        const retained = restrictDirectory(row);
        const cache = new TranscriptCache();
        await this.observer.removing(device.deviceId, row.sessions.filter((session) => !retained.sessions.includes(session)).map((session) => session.id));
        for (const session of row.sessions) if (!retained.sessions.includes(session)) await cache.clear({ accountId, desktopDeviceId: device.deviceId, sessionId: session.id });
        row.sessions = retained.sessions;
        row.projects = retained.projects;
        await saveDirectory(accountId, row, () => this.rows.get(device.deviceId) === row && generation === this.generation);
      }
    }
    this.emit();
    await Promise.allSettled(available.map(async (device) => {
      try { await this.connect(device.deviceId); }
      catch (error) { if (generation === this.generation) this.observer.error(error); }
    }));
  }

  async connect(id: string): Promise<MobileRelay> {
    let relay = this.relays.get(id);
    if (!relay) {
      relay = new MobileRelay(this.account, id, {
        event: (event) => { if (this.relays.get(id) === relay) this.observer.event(id, event); },
        state: (connection) => {
          const row = this.rows.get(id);
          if (row && this.relays.get(id) === relay) { row.connection = connection; this.emit(); }
        },
        restored: async () => {
          if (this.relays.get(id) !== relay) return;
          await relay!.watchDirectory(); await this.refresh(id); await this.observer.restored(id);
        },
        directoryChanged: () => { void this.refresh(id).catch(this.observer.error); },
        accountChanged: this.observer.accountChanged,
        error: this.observer.error,
      });
      this.relays.set(id, relay);
    }
    if (relay.client.state === "connected") { await this.refresh(id); return relay; }
    if (relay.client.state === "connecting" || relay.client.state === "reconnecting") return relay;
    await relay.connect();
    if (this.relays.get(id) === relay) {
      await relay.watchDirectory(); await this.refresh(id);
      if (this.relays.get(id) === relay) await this.observer.restored(id);
    }
    return relay;
  }

  refresh(id: string): Promise<void> {
    if (this.jobs.has(id)) { this.refreshAgain.add(id); return this.jobs.get(id)!; }
    const relay = this.relays.get(id); const row = this.rows.get(id);
    const accountId = this.account.session?.account.id;
    if (!relay || !row || !accountId || relay.client.state !== "connected") return Promise.resolve();
    const job = (async () => {
      do {
        this.refreshAgain.delete(id);
        const before = this.rows.get(id);
        if (!before) return;
        const directory = await relay.directory();
        if (this.relays.get(id) !== relay || this.account.session?.account.id !== accountId) return;
        // A grant/discovery update replaced the row while the request was running.
        // Read again under the current authorization before committing metadata.
        if (before !== this.rows.get(id)) { this.refreshAgain.add(id); continue; }
        if (!before.grants.some((grant) => grant.scope.kind === "account")) {
          const permitted = (session: MobileDirectoryPage["sessions"][number]) => before.grants.some((grant) =>
            grant.scope.kind === "session" ? grant.scope.id === session.id : grant.scope.id === session.projectId);
          directory.sessions = directory.sessions.filter(permitted);
          directory.projects = directory.projects.filter((project) => before.grants.some((grant) => grant.scope.kind === "project" && grant.scope.id === project.id) || directory.sessions.some((session) => session.projectId === project.id));
        }
        const cache = new TranscriptCache();
        await this.observer.removing(id, before.sessions.filter((session) => !directory.sessions.some((current) => current.id === session.id)).map((session) => session.id));
        if (before !== this.rows.get(id)) { this.refreshAgain.add(id); continue; }
        for (const session of before.sessions) if (!directory.sessions.some((current) => current.id === session.id)) {
          await cache.clear({ accountId, desktopDeviceId: id, sessionId: session.id });
        }
        await saveDirectory(accountId, directory, () => this.relays.get(id) === relay && before === this.rows.get(id));
        if (this.relays.get(id) !== relay || before !== this.rows.get(id)) { this.refreshAgain.add(id); continue; }
        this.rows.set(id, { ...before, ...directory });
        this.emit();
      } while (this.refreshAgain.has(id));
    })().finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
    return job;
  }

  async close(): Promise<void> {
    this.generation++;
    const relays = [...this.relays.values()];
    this.relays.clear(); this.rows.clear(); this.jobs.clear();
    this.refreshAgain.clear();
    await Promise.all(relays.map((relay) => relay.close()));
    this.emit();
  }
}
