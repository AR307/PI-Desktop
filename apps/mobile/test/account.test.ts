import { describe, expect, it } from "vitest";
import { generateKeyPairSync, privateDecrypt } from "node:crypto";
import { MobileAccount, type MobileAuthSession } from "../src/services/account";
import type { CredentialStore } from "../src/services/storage";

function store(): CredentialStore & { value: string | null } {
  return { value: null, async read() { return this.value; }, async write(value) { this.value = value; }, async clear() { this.value = null; } };
}
function session(overrides: Partial<MobileAuthSession> = {}): MobileAuthSession {
  return { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresAt: new Date(Date.now() + 900_000).toISOString(), account: { id: "fixture-user", name: "Fixture" }, ...overrides };
}
function response(data: unknown) { return Response.json({ success: true, data }); }

describe("mobile account user path", () => {
  it("signs in through a challenge, pairs one scope, restores securely and signs out", async () => {
    const credentials = store();
    const requested: { path: string; body: Record<string, unknown>; authorization: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const authorization = new Headers(init?.headers).get("Authorization"); requested.push({ path, body, authorization });
      switch (path) {
        case "/api/pi-mobile/auth/encryption-key": return response({ enabled: false });
        case "/api/pi-mobile/auth/login": return response({ challenge: { challengeId: "challenge-one", type: "totp" } });
        case "/api/pi-mobile/auth/challenge": return response({ session: session() });
        case "/api/pi-sync/devices/register": return response({ deviceId: "phone-one", deviceSecret: "phone-secret" });
        case "/api/pi-sync/pairings/claim": return response({ grant: { id: "grant-one", scope: { kind: "session", id: "session-one", label: "Build app" } } });
        case "/api/pi-sync/grants": return response({ grants: [{ id: "grant-one" }] });
        case "/api/pi-mobile/auth/logout": return response({});
        default: throw new Error(`Unexpected path ${path}`);
      }
    };
    const account = new MobileAccount("https://fixture.invalid", credentials, fetcher);
    expect(await account.restore()).toBe(false);
    expect(await account.login("fixture", "test-only-password")).toEqual({ challenge: { challengeId: "challenge-one", type: "totp" } });
    expect(credentials.value).toBeNull();
    await account.challenge("challenge-one", "123456");
    await account.register();
    expect((await account.pair("12345678")).id).toBe("grant-one");
    expect(requested.find((request) => request.path.endsWith("claim"))?.body).toEqual({ code: "12345678", deviceId: "phone-one" });
    expect(requested.find((request) => request.path.endsWith("claim"))?.authorization).toBe("Bearer fixture-access");
    expect(credentials.value).not.toContain("test-only-password");
    const restored = new MobileAccount("https://fixture.invalid", credentials, fetcher);
    expect(await restored.restore()).toBe(true);
    expect(restored.session?.deviceId).toBe("phone-one");
    expect(await restored.grants()).toEqual([{ id: "grant-one" }]);
    expect(await restored.logout()).toBe(true);
    expect(credentials.value).toBeNull();
    expect(restored.session).toBeNull();
  });

  it("shares one refresh between simultaneous foreground requests and stores both rotated tokens", async () => {
    const credentials = store();
    credentials.value = JSON.stringify({
      session: session({ expiresAt: new Date(0).toISOString() }),
      device: { accountId: "fixture-user", deviceId: "phone-one", deviceSecret: "phone-secret" },
    });
    let refreshCount = 0;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/refresh")) { refreshCount++; await wait; return response({ session: session({ accessToken: "rotated-access", refreshToken: "rotated-refresh" }) }); }
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer rotated-access");
      return response({ grants: [] });
    };
    const account = new MobileAccount("https://fixture.invalid", credentials, fetcher);
    const restoring = account.restore();
    await Promise.resolve(); await Promise.resolve();
    const first = account.grants(); const second = account.grants();
    release();
    expect(await restoring).toBe(true); await Promise.all([first, second]);
    expect(refreshCount).toBe(1);
    const saved = JSON.parse(credentials.value!);
    expect(saved.session).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotated-refresh" });
    expect(saved.device).toEqual({ accountId: "fixture-user", deviceId: "phone-one", deviceSecret: "phone-secret" });
  });

  it("encrypts the password when MC enables the RSA policy", async () => {
    const credentials = store();
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    let loginBody: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("encryption-key")) return response({ enabled: true, encryptionKeyId: "key-1", publicKey, algorithm: "RSA-OAEP-256" });
      if (path.endsWith("/login")) { loginBody = JSON.parse(String(init?.body)); return response({ session: session() }); }
      throw new Error(`Unexpected path ${path}`);
    };
    const account = new MobileAccount("https://fixture.invalid", credentials, fetcher);
    await account.login("fixture", "test-only-password");
    expect(loginBody?.password).toBeUndefined();
    expect(typeof loginBody?.passwordEncrypted).toBe("string");
    const decrypted = privateDecrypt({ key: privateKey, oaepHash: "sha256" }, Buffer.from(String(loginBody?.passwordEncrypted), "base64")).toString("utf8");
    expect(decrypted).toBe("test-only-password");
  });

  it("clears local credentials when the phone signs out without network", async () => {
    const credentials = store(); credentials.value = JSON.stringify({ session: session(), device: { accountId: "fixture-user", deviceId: "phone-one", deviceSecret: "phone-secret" } });
    const account = new MobileAccount("https://fixture.invalid", credentials, async () => { throw new TypeError("Network unavailable"); });
    await account.restore(); expect(await account.logout()).toBe(false);
    expect(credentials.value).toBeNull();
  });

  it("retains the device identity when an expired session is replaced", async () => {
    const credentials = store();
    credentials.value = JSON.stringify({
      session: session({ expiresAt: new Date(0).toISOString() }),
      device: { accountId: "fixture-user", deviceId: "phone-one", deviceSecret: "phone-secret" },
    });
    const registrations: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (path.endsWith("/refresh")) return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "expired" } }), { status: 401, headers: { "Content-Type": "application/json" } });
      if (path.endsWith("/encryption-key")) return response({ enabled: false });
      if (path.endsWith("/login")) return response({ session: session({ accessToken: "new-access", refreshToken: "new-refresh" }) });
      if (path.endsWith("/devices/register")) { registrations.push(body); return response({ deviceId: "phone-one" }); }
      throw new Error(`Unexpected path ${path}`);
    };
    const account = new MobileAccount("https://fixture.invalid", credentials, fetcher);
    expect(await account.restore()).toBe(false);
    expect(JSON.parse(credentials.value!).device).toEqual({ accountId: "fixture-user", deviceId: "phone-one", deviceSecret: "phone-secret" });
    await account.login("fixture", "test-only-password");
    await account.register();
    expect(registrations).toEqual([{ deviceId: "phone-one", deviceSecret: "phone-secret", kind: "mobile", name: "PI Android" }]);
  });
});
