import type { MobileGrant, MobileRelayTicket } from "@pi-desktop/shared";
import type { CredentialStore } from "./storage";

export type MobileAuthSession = {
  accessToken: string; refreshToken: string; expiresAt: string;
  account: { id: string; name: string };
  deviceId?: string;
};
export type MobileAuthChallenge = {
  challengeId: string; type: "totp" | "captcha"; message?: string; url?: string;
};
export type LoginResult = { session: MobileAuthSession } | { challenge: MobileAuthChallenge };
export type MobileDevice = { deviceId: string; name: string; kind: "mobile" | "desktop"; online: boolean };
type MobileDeviceIdentity = { accountId: string; deviceId: string; deviceSecret: string };
type StoredCredentials = { session?: MobileAuthSession; device?: MobileDeviceIdentity };

export class AccountError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function authSession(value: unknown): MobileAuthSession {
  if (!value || typeof value !== "object") throw new AccountError("INVALID_RESPONSE", "Invalid account response");
  const row = value as Record<string, unknown>;
  const account = row.account as Record<string, unknown> | undefined;
  if (typeof row.accessToken !== "string" || typeof row.refreshToken !== "string" || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) || typeof account?.id !== "string" || typeof account.name !== "string") {
    throw new AccountError("INVALID_RESPONSE", "Invalid account response");
  }
  return {
    accessToken: row.accessToken, refreshToken: row.refreshToken, expiresAt: row.expiresAt,
    account: { id: account.id, name: account.name },
    ...(typeof row.deviceId === "string" ? { deviceId: row.deviceId } : {}),
  };
}

function deviceIdentity(value: unknown): MobileDeviceIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  return typeof row.accountId === "string" && typeof row.deviceId === "string" && typeof row.deviceSecret === "string"
    ? { accountId: row.accountId, deviceId: row.deviceId, deviceSecret: row.deviceSecret }
    : undefined;
}

function storedCredentials(value: unknown): StoredCredentials {
  if (!value || typeof value !== "object") throw new AccountError("INVALID_RESPONSE", "Invalid saved account response");
  const row = value as Record<string, unknown>;
  // Accept the pre-identity record once so an upgrade does not strand a
  // signed-in installation; all subsequent writes use the split shape.
  if (typeof row.accessToken === "string") {
    const session = authSession(row);
    const device = typeof row.deviceId === "string" && typeof row.deviceSecret === "string"
      ? { accountId: session.account.id, deviceId: row.deviceId, deviceSecret: row.deviceSecret }
      : undefined;
    return { session, device };
  }
  const session = row.session === undefined ? undefined : authSession(row.session);
  const device = deviceIdentity(row.device);
  return { session, device };
}

type MobileEncryptionKey =
  | { enabled: false }
  | { enabled: true; encryptionKeyId: string; publicKey: string; algorithm: "RSA-OAEP-256" };

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptPassword(password: string, key: Extract<MobileEncryptionKey, { enabled: true }>): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new AccountError("ENCRYPTION_UNAVAILABLE", "Password encryption is unavailable");
  const pem = key.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
  let imported: CryptoKey;
  try {
    const source = base64Bytes(pem);
    const keyData = new ArrayBuffer(source.byteLength);
    new Uint8Array(keyData).set(source);
    imported = await crypto.subtle.importKey("spki", keyData, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  } catch {
    throw new AccountError("INVALID_RESPONSE", "Invalid account encryption key");
  }
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, imported, new TextEncoder().encode(password));
  const bytes = new Uint8Array(encrypted);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class MobileAccount {
  private current: MobileAuthSession | null = null;
  private device?: MobileDeviceIdentity;
  private refreshing: Promise<void> | null = null;
  private generation = 0;
  constructor(readonly origin: string, private readonly store: CredentialStore, private readonly fetcher: typeof fetch = fetch.bind(globalThis)) {}
  get session() { return this.current; }

  async restore(): Promise<boolean> {
    const raw = await this.store.read();
    if (!raw) return false;
    const saved = storedCredentials(JSON.parse(raw));
    this.device = saved.device;
    if (!saved.session) return false;
    this.current = saved.session;
    if (this.device?.accountId === this.current.account.id) this.current = { ...this.current, deviceId: this.device.deviceId };
    try { await this.ensureFresh(); return true; }
    catch (error) {
      if (error instanceof AccountError && error.code === "UNAUTHORIZED") {
        this.current = null;
        await this.saveCredentials();
        return false;
      }
      throw error;
    }
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const encryption = await this.raw<MobileEncryptionKey>("/api/pi-mobile/auth/encryption-key", undefined, false);
    let body: Record<string, string> = { username, password };
    if (encryption && encryption.enabled) {
      if (!encryption.encryptionKeyId || !encryption.publicKey || encryption.algorithm !== "RSA-OAEP-256") {
        throw new AccountError("INVALID_RESPONSE", "Invalid account encryption policy");
      }
      body = { username, passwordEncrypted: await encryptPassword(password, encryption), encryptionKeyId: encryption.encryptionKeyId };
    }
    const result = await this.raw<LoginResult>("/api/pi-mobile/auth/login", body, false);
    return this.acceptLogin(result);
  }
  async challenge(challengeId: string, code: string): Promise<LoginResult> {
    return this.acceptLogin(await this.raw<LoginResult>("/api/pi-mobile/auth/challenge", { challengeId, code }, false));
  }
  private async acceptLogin(result: LoginResult): Promise<LoginResult> {
    if ("challenge" in result) {
      if (!result.challenge || typeof result.challenge.challengeId !== "string" || !["totp", "captcha"].includes(result.challenge.type) || (result.challenge.type === "captcha" && (!result.challenge.url || !/^https:\/\//.test(result.challenge.url)))) throw new AccountError("INVALID_RESPONSE", "Invalid login challenge");
      return result;
    }
    this.current = authSession(result.session);
    if (this.device && this.device.accountId === this.current.account.id) {
      this.current = { ...this.current, deviceId: this.device.deviceId };
    } else if (this.device && this.device.accountId !== this.current.account.id) {
      this.device = undefined;
    }
    this.generation++;
    await this.saveCredentials();
    return { session: this.current };
  }
  async register(): Promise<string> {
    const current = this.current;
    if (!current) throw new AccountError("UNAUTHORIZED", "authentication_expired");
    const identity = this.device?.accountId === current.account.id ? this.device : undefined;
    const hasIdentity = !!identity;
    const result = await this.request<{ deviceId: string; deviceSecret?: string }>("/api/pi-sync/devices/register", hasIdentity
      ? { deviceId: identity.deviceId, deviceSecret: identity.deviceSecret, kind: "mobile", name: "PI Android" }
      : { kind: "mobile", name: "PI Android" });
    const deviceSecret = result.deviceSecret ?? identity?.deviceSecret;
    if (!result.deviceId || !deviceSecret) throw new AccountError("INVALID_RESPONSE", "Missing device identity");
    this.device = { accountId: current.account.id, deviceId: result.deviceId, deviceSecret };
    this.current = { ...current, deviceId: result.deviceId };
    await this.saveCredentials();
    return result.deviceId;
  }
  async grants(): Promise<MobileGrant[]> { return (await this.request<{ grants: MobileGrant[] }>("/api/pi-sync/grants")).grants; }
  async devices(): Promise<MobileDevice[]> { return (await this.request<{ devices: MobileDevice[] }>("/api/pi-sync/devices")).devices; }
  async pair(code: string): Promise<MobileGrant> {
    return (await this.request<{ grant: MobileGrant }>("/api/pi-sync/pairings/claim", { code, deviceId: this.requireDeviceIdentity().deviceId })).grant;
  }
  async revoke(grantId: string): Promise<void> { await this.request(`/api/pi-sync/grants/${encodeURIComponent(grantId)}/revoke`, {}); }
  async ticket(desktopDeviceId: string): Promise<MobileRelayTicket> {
    return this.request("/api/pi-sync/relay/ticket", { deviceId: this.requireDeviceIdentity().deviceId, desktopDeviceId });
  }
  async logout(): Promise<boolean> {
    let confirmed = true;
    try { await this.request("/api/pi-mobile/auth/logout", { refreshToken: this.current?.refreshToken }); }
    catch { confirmed = false; }
    await this.clear();
    return confirmed;
  }
  async clear(): Promise<void> { this.generation++; this.current = null; this.device = undefined; await this.store.clear(); }

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
      const refreshed = authSession(result.session);
      this.current = refreshed;
      if (this.device?.accountId === refreshed.account.id) this.current = { ...refreshed, deviceId: this.device.deviceId };
      await this.saveCredentials();
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  private async raw<T>(path: string, body: unknown, authorized: boolean): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authorized && this.current) headers.Authorization = `Bearer ${this.current.accessToken}`;
    const response = await this.fetcher(new URL(path, this.origin), { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const result: unknown = await response.json();
    const envelope = result as { success?: boolean; data?: T; error?: { code?: string; message?: string } };
    if (!response.ok || envelope.success !== true) {
      throw new AccountError(response.status === 401 ? "UNAUTHORIZED" : envelope.error?.code ?? `HTTP_${response.status}`, envelope.error?.message ?? "request_failed");
    }
    if (!("data" in envelope)) throw new AccountError("INVALID_RESPONSE", "Missing response data");
    return envelope.data as T;
  }

  private requireDeviceIdentity(): MobileDeviceIdentity {
    if (!this.current || !this.device || this.device.accountId !== this.current.account.id) throw new AccountError("DEVICE_NOT_REGISTERED", "Device registration is required");
    return this.device;
  }

  private saveCredentials(): Promise<void> {
    const device = this.device;
    const value: StoredCredentials = { ...(this.current ? { session: this.current } : {}), ...(device ? { device } : {}) };
    return this.store.write(JSON.stringify(value));
  }
}
