import type { MirrorCodingAccountState, MirrorCodingProviderSync } from "@pi-desktop/shared";
import type { ModelsDevCatalog } from "../models-dev-catalog";
import { compileCatalog, parseCatalog } from "./catalog";
import { MirrorCodingCredentials, type CredentialState, type Grant } from "./credentials";
import { AuthorizationError, beginAuthorization, CLIENT_ID, exchangeToken, type Fetch } from "./oauth";

type Dependencies = {
  origin: string;
  credentials: MirrorCodingCredentials;
  fetch: Fetch;
  modelsDev: ModelsDevCatalog;
  openExternal(url: string): Promise<void>;
  syncProviders(input: MirrorCodingProviderSync): Promise<void>;
  completeWelcome(): Promise<void>;
  changed(state: MirrorCodingAccountState): void;
};

/** Account lifecycle and single-flight network work. No token-bearing public API. */
export class MirrorCodingAccount {
  private saved: CredentialState = { pendingRevocations: [] };
  private state: MirrorCodingAccountState = { status: "signed_out", sync: "idle", pendingRevocation: false };
  private flow?: Awaited<ReturnType<typeof beginAuthorization>>;
  private epoch = 0;
  private initialization?: Promise<void>;
  private tokenRefresh?: Promise<Grant>;
  private catalogRefresh?: Promise<void>;
  private revoking?: Promise<void>;
  constructor(private deps: Dependencies) {}

  snapshot(): MirrorCodingAccountState { return structuredClone(this.state); }
  private restoredStatus(): MirrorCodingAccountState["status"] {
    if (!this.saved.active) return "signed_out";
    return this.saved.active.authorizationExpiresAt > Date.now() ? "connected" : "reauthorize";
  }
  private publish(patch: Partial<MirrorCodingAccountState> = {}): void {
    this.state = { ...this.state, ...patch, pendingRevocation: this.saved.pendingRevocations.length > 0 };
    this.deps.changed(this.snapshot());
  }

  initialize(): Promise<void> {
    return this.initialization ??= (async () => {
      try {
        this.saved = await this.deps.credentials.load();
        const grant = this.saved.active;
        if (grant) {
          this.publish({
            status: grant.authorizationExpiresAt > Date.now() ? "connected" : "reauthorize",
            account: grant.catalog?.user, catalog: grant.catalog,
            authorizationExpiresAt: grant.authorizationExpiresAt,
          });
          await this.deps.modelsDev.ensureLoaded();
          if (grant.catalog) await this.deps.syncProviders(compileCatalog(grant.catalog, this.deps.modelsDev));
        } else {
          await this.deps.syncProviders({ accountId: null, groups: [] });
          this.publish();
        }
      } catch (error) {
        this.publish({ error: this.errorCode(error), sync: "error" });
      }
    })();
  }

  async startLogin(): Promise<MirrorCodingAccountState> {
    await this.initialize();
    if (this.flow || this.state.status === "authorizing") return this.snapshot();
    const epoch = ++this.epoch;
    try {
      this.deps.credentials.assertAvailable();
      this.publish({ status: "authorizing", error: undefined });
      const flow = await beginAuthorization(this.deps.origin, this.deps.fetch);
      if (epoch !== this.epoch) { flow.cancel(); return this.snapshot(); }
      this.flow = flow;
      void flow.completion.then(async (grant) => {
        await Promise.allSettled([this.tokenRefresh, this.catalogRefresh]);
        if (epoch !== this.epoch) {
          this.saved.pendingRevocations.push(grant.refreshToken);
          await this.deps.credentials.save(this.saved);
          await this.retryRevocation();
          return;
        }
        const previous = this.saved.active;
        const next = { active: grant, pendingRevocations: [...this.saved.pendingRevocations, ...(previous ? [previous.refreshToken] : [])] };
        try { await this.deps.credentials.save(next); }
        catch (error) {
          this.saved.pendingRevocations.push(grant.refreshToken);
          await this.retryRevocation();
          throw error;
        }
        if (epoch !== this.epoch) {
          this.saved.pendingRevocations.push(grant.refreshToken);
          await this.deps.credentials.save(this.saved);
          await this.retryRevocation();
          return;
        }
        this.saved = next;
        this.publish({ status: "connected", sync: "idle", account: undefined, catalog: undefined, authorizationExpiresAt: grant.authorizationExpiresAt });
        await this.deps.syncProviders({ accountId: null, groups: [] });
        await this.deps.completeWelcome();
        await this.refreshCatalog();
        await this.retryRevocation();
      }).catch((error: unknown) => {
        if (epoch !== this.epoch) return;
        this.publish({ status: this.restoredStatus(), sync: this.state.catalog ? "success" : "idle", error: this.errorCode(error) });
      }).finally(() => {
        if (this.flow === flow) this.flow = undefined;
      });
      await this.deps.openExternal(flow.url);
    } catch (error) {
      this.flow?.cancel();
      this.flow = undefined;
      this.publish({ status: this.restoredStatus(), error: this.errorCode(error) });
    }
    return this.snapshot();
  }

  cancelLogin(): MirrorCodingAccountState {
    this.epoch++;
    this.flow?.cancel();
    this.flow = undefined;
    this.publish({ status: this.restoredStatus(), sync: this.state.catalog ? "success" : "idle", error: undefined });
    return this.snapshot();
  }

  private async validGrant(rejectedAccessToken?: string): Promise<Grant> {
    const grant = this.saved.active;
    if (!grant || this.state.status === "reauthorize" || grant.authorizationExpiresAt <= Date.now()) {
      if (grant) this.publish({ status: "reauthorize" });
      throw new AuthorizationError("reauthorization_required");
    }
    if (grant.accessExpiresAt > Date.now() + 30_000 && (!rejectedAccessToken || rejectedAccessToken !== grant.accessToken)) return grant;
    if (this.tokenRefresh) return this.tokenRefresh;
    this.tokenRefresh = (async () => {
      try {
        const refreshed = await exchangeToken(this.deps.origin, this.deps.fetch, {
          grant_type: "refresh_token", refresh_token: grant.refreshToken,
        });
        if (this.saved.active !== grant) throw new Error("account_changed");
        refreshed.authorizationExpiresAt = Math.min(refreshed.authorizationExpiresAt, grant.authorizationExpiresAt);
        refreshed.catalog = grant.catalog;
        this.saved.active = refreshed;
        await this.deps.credentials.save(this.saved);
        this.publish({ authorizationExpiresAt: refreshed.authorizationExpiresAt });
        return refreshed;
      } catch (error) {
        if (error instanceof AuthorizationError && this.saved.active === grant) this.publish({ status: "reauthorize" });
        if (error instanceof Error && error.message === "credential_write_failed") this.publish({ status: "reauthorize", error: "credential_write_failed" });
        throw error;
      } finally {
        this.tokenRefresh = undefined;
      }
    })();
    return this.tokenRefresh;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    await this.initialize();
    let grant = await this.validGrant();
    const send = () => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${grant.accessToken}`);
      return this.deps.fetch(`${this.deps.origin}${path}`, { ...init, headers, redirect: "error" });
    };
    let response = await send();
    if (response.status === 401) {
      await response.body?.cancel();
      grant = await this.validGrant(grant.accessToken);
      response = await send();
      if (response.status === 401) this.publish({ status: "reauthorize" });
    }
    return response;
  }

  async refreshCatalog(): Promise<void> {
    await this.initialize();
    if (!this.saved.active || this.state.status !== "connected") return;
    if (this.catalogRefresh) return this.catalogRefresh;
    const epoch = this.epoch;
    this.publish({ sync: "syncing", error: undefined });
    this.catalogRefresh = (async () => {
      try {
        const response = await this.request("/api/pi-desktop/catalog", { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error("catalog_failed");
        const catalog = parseCatalog(await response.json());
        await this.deps.modelsDev.ensureLoaded();
        if (epoch !== this.epoch || !this.saved.active) return;
        this.saved.active.catalog = catalog;
        await this.deps.credentials.save(this.saved);
        if (epoch !== this.epoch) return;
        await this.deps.syncProviders(compileCatalog(catalog, this.deps.modelsDev));
        if (epoch !== this.epoch) return;
        this.publish({ account: catalog.user, catalog, sync: "success", syncedAt: Date.now(), error: undefined });
      } catch (error) {
        if (epoch === this.epoch) this.publish({ sync: "error", error: this.errorCode(error) });
      } finally {
        this.catalogRefresh = undefined;
      }
    })();
    return this.catalogRefresh;
  }

  async groupUnavailable(): Promise<void> {
    await this.refreshCatalog();
    this.publish({ error: "model_or_group_unavailable" });
  }

  async logout(): Promise<MirrorCodingAccountState> {
    await this.initialize();
    this.cancelLogin();
    await Promise.allSettled([this.tokenRefresh, this.catalogRefresh]);
    if (this.saved.active) {
      this.saved.pendingRevocations.push(this.saved.active.refreshToken);
      // Persist the revoke-only copy before attempting a network operation.
      await this.deps.credentials.save(this.saved);
      await this.retryRevocation();
      this.saved.active = undefined;
      await this.deps.credentials.save(this.saved);
    }
    await this.deps.syncProviders({ accountId: null, groups: [] });
    this.state = { status: "signed_out", sync: "idle", pendingRevocation: false };
    this.publish();
    return this.snapshot();
  }

  async retryRevocation(): Promise<void> {
    if (this.revoking) return this.revoking;
    this.revoking = (async () => {
      for (const token of [...this.saved.pendingRevocations]) {
        try {
          const response = await this.deps.fetch(`${this.deps.origin}/api/pi-desktop/oauth/revoke`, {
            method: "POST", body: new URLSearchParams({ client_id: CLIENT_ID, token }),
            signal: AbortSignal.timeout(10_000), redirect: "error",
          });
          await response.body?.cancel();
          if (response.status !== 200) continue;
          this.saved.pendingRevocations = this.saved.pendingRevocations.filter((item) => item !== token);
          await this.deps.credentials.save(this.saved);
        } catch {
          // The encrypted revoke-only record remains available for explicit retry.
        }
      }
      this.publish();
    })().finally(() => { this.revoking = undefined; });
    return this.revoking;
  }

  dispose(): void { this.epoch++; this.flow?.cancel(); this.flow = undefined; }

  private errorCode(error: unknown): string {
    const code = error instanceof Error ? error.message : "";
    return /^[a-z_]+$/.test(code) ? code : "network_error";
  }
}
