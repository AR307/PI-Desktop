import { describe, expect, it } from "vitest";
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
        case "/api/pi-mobile/auth/login": return response({ challenge: { challengeId: "challenge-one", type: "totp" } });
        case "/api/pi-mobile/auth/challenge": return response({ session: session() });
        case "/api/pi-sync/devices/register": return response({ deviceId: "phone-one" });
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
    credentials.value = JSON.stringify(session({ expiresAt: new Date(0).toISOString(), deviceId: "phone-one" }));
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
    expect(JSON.parse(credentials.value!)).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotated-refresh", deviceId: "phone-one" });
  });

  it("clears local credentials when the phone signs out without network", async () => {
    const credentials = store(); credentials.value = JSON.stringify(session());
    const account = new MobileAccount("https://fixture.invalid", credentials, async () => { throw new TypeError("Network unavailable"); });
    await account.restore(); expect(await account.logout()).toBe(false);
    expect(credentials.value).toBeNull();
  });
});
