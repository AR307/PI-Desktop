import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Grant } from "./credentials";

const CALLBACK = "/oauth/mirrorcoding/callback";
export const CLIENT_ID = "pi-desktop";
export type Fetch = typeof globalThis.fetch;

export class AuthorizationError extends Error {}

export async function exchangeToken(
  origin: string,
  fetch: Fetch,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<Grant> {
  const response = await fetch(`${origin}/api/pi-desktop/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    if (value.error === "invalid_grant" || value.error === "invalid_token") {
      throw new AuthorizationError("reauthorization_required");
    }
    throw new Error("token_exchange_failed");
  }
  if (typeof value.access_token !== "string" || !value.access_token ||
      typeof value.refresh_token !== "string" || !value.refresh_token ||
      value.token_type !== "Bearer" || typeof value.expires_in !== "number" || value.expires_in <= 0 ||
      typeof value.refresh_expires_in !== "number" || value.refresh_expires_in <= 0 ||
      (typeof value.authorization_id !== "string" && typeof value.authorization_id !== "number")) {
    throw new Error("invalid_token_response");
  }
  const now = Date.now();
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    accessExpiresAt: now + value.expires_in * 1_000,
    authorizationExpiresAt: now + value.refresh_expires_in * 1_000,
    authorizationId: String(value.authorization_id),
  };
}

export async function beginAuthorization(origin: string, fetch: Fetch, timeoutMs = 10 * 60_000) {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const abort = new AbortController();
  let redirectUri = "";
  let settled = false;
  let resolveGrant!: (grant: Grant) => void;
  let rejectGrant!: (error: Error) => void;
  const completion = new Promise<Grant>((resolve, reject) => {
    resolveGrant = resolve;
    rejectGrant = reject;
  });
  // A cancellation can arrive before the browser launch has resolved.
  void completion.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", redirectUri);
    if (request.method !== "GET" || url.pathname !== CALLBACK) {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get("state") !== state || settled) {
      response.writeHead(400).end("Invalid authorization callback.");
      return;
    }
    settled = true;
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("MirrorCoding: You can return to PI-Desktop. / 请返回 PI-Desktop。");
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) {
      rejectGrant(new Error("authorization_cancelled"));
      return;
    }
    void exchangeToken(origin, fetch, {
      grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier,
    }, abort.signal).then(resolveGrant, rejectGrant);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CALLBACK}`;
  const cancel = (reason = "authorization_cancelled") => {
    settled = true;
    abort.abort();
    rejectGrant(new Error(reason));
  };
  const timeout = setTimeout(() => cancel("authorization_timed_out"), timeoutMs);
  const finish = () => {
    clearTimeout(timeout);
    server.close();
    server.closeAllConnections();
  };
  void completion.then(finish, finish);
  const url = new URL("/api/pi-desktop/oauth/authorize", origin);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", scope: "pi_desktop", redirect_uri: redirectUri,
    state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), completion, cancel };
}
