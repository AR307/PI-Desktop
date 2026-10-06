import type { MobileGrant, MobileRelayTicket } from "@pi-desktop/shared";
import type { CredentialStore } from "./storage";
import { MobileRequestCooldown, MobileServiceError } from "@pi-desktop/shared";
import { loginPassword } from "./login-password";

export type MobileAuthSession = {
  accessToken: string; refreshToken: string; expiresAt: string;
  account: { id: string; name: string };
  deviceId?: string;
  deviceSecret?: string;
};
export type MobileAuthChallenge = {
  challengeId: string; type: "totp" | "email" | "captcha"; message?: string; url?: string;
};
export type LoginResult = { session: MobileAuthSession } | { challenge: MobileAuthChallenge };
export type MobileDevice = { deviceId: string; name: string; kind: "mobile" | "desktop"; online: boolean; accountSyncEnabled?: boolean };

export class AccountError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryAt?: number) { super(message); }
}

function authSession(value: unknown): MobileAuthSession {
  if (!value || typeof value !== "object") throw new AccountError("INVALID_RESPONSE", "Invalid account response");
  const row = value as Record<string, unknown>;
  const account = row.account as Record<string, unknown> | undefined;
  if (typeof row.accessToken !== "string" || typeof row.refreshToken !== "string" || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) || typeof account?.id !== "string" || typeof account.name !== "string") {
    throw new AccountError("INVALID_RESPONSE", "Invalid account response");
  }
  return { accessToken: row.accessToken, refreshToken: row.refreshToken, expiresAt: row.expiresAt, account: { id: account.id, name: account.name }, ...(typeof row.deviceId === "string" ? { deviceId: row.deviceId } : {}), ...(typeof row.deviceSecret === "string" ? { deviceSecret: row.deviceSecret } : {}) };
}

export class MobileAccount {
  private current: MobileAuthSession | null = null;
  private refreshing: Promise<void> | null = null;
  private generation = 0;
  private registering: Promise<string> | null = null;
  private readonly authCooldown = new MobileRequestCooldown();
  private readonly syncCooldown = new MobileRequestCooldown();
  constructor(readonly origin: string, private readonly store: CredentialStore, private readonly fetcher: typeof fetch = fetch.bind(globalThis)) {}
  get session() { return this.current; }

  async restore(): Promise<boolean> {
    const raw = await this.store.read();
    if (!raw) return false;
    this.current = authSession(JSON.parse(raw));
    // Network validation happens after the cached account has been displayed.
    // Expired credentials cannot send operations, but do not prevent offline reading.
    return true;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const key = await this.raw<Parameters<typeof loginPassword>[1]>("/api/pi-mobile/auth/encryption-key", undefined, false);
    const result = await this.raw<LoginResult>("/api/pi-mobile/auth/login", { username, ...await loginPassword(password, key) }, false);
    return this.acceptLogin(result);
  }
  async challenge(challengeId: string, code: string): Promise<LoginResult> {
    return this.acceptLogin(await this.raw<LoginResult>("/api/pi-mobile/auth/challenge", { challengeId, code }, false));
  }
  private async acceptLogin(result: LoginResult): Promise<LoginResult> {
    if ("challenge" in result) {
      if (!result.challenge || typeof result.challenge.challengeId !== "string" || !["totp", "email", "captcha"].includes(result.challenge.type)) throw new AccountError("INVALID_RESPONSE", "Invalid login challenge");
      return result;
    }
    this.current = authSession(result.session);
    this.generation++;
    await this.store.write(JSON.stringify(this.current));
    return { session: this.current };
  }
  register(): Promise<string> {
    if (this.current?.deviceId && this.current.deviceSecret) return Promise.resolve(this.current.deviceId);
    return this.registering ??= this.registerOnce().finally(() => { this.registering = null; });
  }
  private async registerOnce(): Promise<string> {
    const generation = this.generation;
    const result = await this.request<{ deviceId: string; deviceSecret?: string }>("/api/pi-sync/devices/register", { kind: "mobile", name: "PI Android" });
    if (generation !== this.generation || !this.current) throw new AccountError("UNAUTHORIZED", "authentication_expired");
    if (!result.deviceId || !result.deviceSecret) throw new AccountError("DEVICE_IDENTITY_MISSING", "DEVICE_IDENTITY_MISSING");
    this.current = { ...this.current, deviceId: result.deviceId, deviceSecret: result.deviceSecret };
    await this.store.write(JSON.stringify(this.current));
    return result.deviceId;
  }
  async grants(): Promise<MobileGrant[]> { return (await this.request<{ grants: MobileGrant[] }>("/api/pi-sync/grants")).grants; }
  async devices(): Promise<MobileDevice[]> { return (await this.request<{ devices: MobileDevice[] }>("/api/pi-sync/devices")).devices; }
  async pair(code: string): Promise<MobileGrant> {
    await this.register();
    return (await this.request<{ grant: MobileGrant }>("/api/pi-sync/pairings/claim", { code, deviceId: this.current?.deviceId })).grant;
  }
  async revoke(grantId: string): Promise<void> { await this.request(`/api/pi-sync/grants/${encodeURIComponent(grantId)}/revoke`, {}); }
  async ticket(desktopDeviceId: string): Promise<MobileRelayTicket> {
    return this.request("/api/pi-sync/relay/ticket", { deviceId: this.current?.deviceId, desktopDeviceId });
  }
  async logout(): Promise<boolean> {
    let confirmed = true;
    try { await this.request("/api/pi-mobile/auth/logout", { refreshToken: this.current?.refreshToken }); }
    catch { confirmed = false; }
    await this.clear();
    return confirmed;
  }
  async clear(): Promise<void> { this.generation++; this.current = null; await this.store.clear(); }

  async request<T>(path: string, body?: unknown): Promise<T> {
    await this.ensureFresh();
    try { return await this.raw<T>(path, body, true); }
    catch (error) {
      if (!(error instanceof AccountError) || error.code !== "UNAUTHORIZED") throw error;
      await this.refresh();
      return this.raw<T>(path, body, true);
    }
  }
  private async ensureFresh(): Promise<void> {
    if (!this.current) throw new AccountError("UNAUTHORIZED", "authentication_expired");
    if (Date.parse(this.current.expiresAt) - Date.now() < 30_000) await this.refresh();
  }
  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const previous = this.current;
    const generation = this.generation;
    if (!previous) return Promise.reject(new AccountError("UNAUTHORIZED", "authentication_expired"));
    this.refreshing = (async () => {
      const result = await this.raw<{ session: MobileAuthSession }>("/api/pi-mobile/auth/refresh", { refreshToken: previous.refreshToken }, false);
      if (generation !== this.generation) throw new AccountError("UNAUTHORIZED", "authentication_expired");
      this.current = { ...authSession(result.session), deviceId: previous.deviceId, deviceSecret: previous.deviceSecret };
      await this.store.write(JSON.stringify(this.current));
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  private async raw<T>(path: string, body: unknown, authorized: boolean): Promise<T> {
    const cooldown = path.startsWith("/api/pi-mobile/auth/") ? this.authCooldown : this.syncCooldown;
    try { cooldown.check(); } catch (error) {
      if (error instanceof MobileServiceError) throw new AccountError(error.code, error.code, error.retryAt);
      throw error;
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authorized && this.current) headers.Authorization = `Bearer ${this.current.accessToken}`;
    const response = await this.fetcher(new URL(path, this.origin), { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    try { return await cooldown.read<T>(response); }
    catch (error) {
      if (!(error instanceof MobileServiceError)) throw error;
      const expired = error.status === 401 && (authorized || path.endsWith("/refresh"));
      throw new AccountError(expired ? "UNAUTHORIZED" : error.code, expired ? "authentication_expired" : error.code, error.retryAt);
    }
  }
}
