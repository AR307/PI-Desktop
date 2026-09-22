import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { HostProcess } from "@pi-desktop/host-runtime";

// Real account/relay + Rust persistence against controllable HTTP failures.
// The desktop acceptance suite covers the actual OS safeStorage and browser UI.
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mirrorcoding-recovery-${Date.now()}`));
await mkdir(output, { recursive: true });
const vite = await createViteServer({ root: join(root, "apps/desktop"), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
const { MirrorCodingAccount } = await vite.ssrLoadModule("/electron/main/mirrorcoding/account.ts");
const { MirrorCodingCredentials } = await vite.ssrLoadModule("/electron/main/mirrorcoding/credentials.ts");
const { MirrorCodingRelay } = await vite.ssrLoadModule("/electron/main/mirrorcoding/relay.ts");
const { beginAuthorization } = await vite.ssrLoadModule("/electron/main/mirrorcoding/oauth.ts");
const { ModelsDevCatalog } = await vite.ssrLoadModule("/electron/main/models-dev-catalog.ts");
const host = new HostProcess({ binaryPath: join(root, "target/debug/pi-desktop-host-core.exe"), dataDir: join(output, "host"), onStderr() {} });
const passed = [];
const check = (label, value = true) => { assert(value, label); passed.push(label); console.log(`PASS ${label}`); };
const until = async (probe, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await probe()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error(`Timed out: ${label}`);
};
const encryptionKey = randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  },
  decryptString(value) {
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey, value.subarray(0, 12));
    cipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString();
  },
};
let authorizationUrl, generation = 0, refreshes = 0, currentAccess = "", catalogReads = 0;
let accountId = 42, catalogMode = "normal", revokeUnavailable = false, expired = false, denyGroup = false;
let nextFailure, streaming, disconnected = false, completedWelcome = false;
const requests = [], revoked = [];
const endpoints = {
  openai: { path: "/v1/chat/completions", method: "POST" },
  "openai-response": { path: "/v1/responses", method: "POST" },
  anthropic: { path: "/v1/messages", method: "POST" },
  gemini: { path: "/v1beta/models/{model}:generateContent", method: "POST" },
};
const catalog = () => ({ success: true, data: {
  user: { id: accountId, display_name: `Account ${accountId}` }, supported_endpoints: endpoints,
  groups: catalogMode === "empty" ? [] : [{ id: "中文 % group", name: "Chinese group", description: "Local acceptance", ratio: 0.06, dynamic_billing: false,
    models: ["gpt-5", "claude-sonnet-4-5", "gemini-2.5-flash", "unlisted-model"].map((id) => ({ id, supported_endpoint_types: Object.keys(endpoints) })) }],
} });
const server = createServer(async (request, response) => {
  const parts = []; for await (const part of request) parts.push(part);
  const body = Buffer.concat(parts).toString();
  const json = (status, value, headers = {}) => { response.writeHead(status, { "content-type": "application/json", ...headers }); response.end(JSON.stringify(value)); };
  if (request.url.endsWith("/oauth/token")) {
    const form = new URLSearchParams(body);
    if (form.get("grant_type") === "refresh_token") {
      refreshes++;
      if (expired) { json(400, { error: "invalid_grant" }); return; }
    } else {
      assert.equal(createHash("sha256").update(form.get("code_verifier")).digest("base64url"), authorizationUrl.searchParams.get("code_challenge"));
      assert.equal(form.get("redirect_uri"), authorizationUrl.searchParams.get("redirect_uri"));
    }
    generation++; currentAccess = `fixture-access-${generation}`;
    json(200, { access_token: currentAccess, refresh_token: `fixture-refresh-${generation}`, authorization_id: `grant-${accountId}`, token_type: "Bearer", expires_in: 900, refresh_expires_in: 86400 }); return;
  }
  if (request.url.endsWith("/oauth/revoke")) {
    if (revokeUnavailable) { json(503, {}); return; }
    revoked.push(new URLSearchParams(body).get("token")); json(200, {}); return;
  }
  if (request.headers.authorization !== `Bearer ${currentAccess}`) { json(401, { error: { message: "Expired fixture access" } }); return; }
  if (request.url.endsWith("/catalog")) {
    catalogReads++;
    json(catalogMode === "offline" ? 503 : 200, catalogMode === "offline" ? {} : catalog()); return;
  }
  requests.push({ path: request.url, group: request.headers["x-mirrorcoding-group"], sdkAuth: Boolean(request.headers["x-api-key"] || request.headers["x-goog-api-key"] || request.url.includes("key=")), body: JSON.parse(body) });
  if (denyGroup) { json(403, { error: { message: "The selected group is not available to this account" } }); return; }
  if (nextFailure) {
    const status = nextFailure; nextFailure = undefined;
    json(status, { error: { message: "Temporary failure" } }, {
      "retry-after": "2", "x-oneapi-request-id": "oneapi-fixture",
      "x-upstream-request-id": "upstream-fixture", "x-request-id": "request-fixture",
      "request-id": "generic-fixture",
    });
    return;
  }
  if (streaming) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"text":"partial"}\n\n');
    response.on("close", () => { disconnected = true; });
    return;
  }
  json(200, { ok: true });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const credentials = new MirrorCodingCredentials(join(output, "credentials.enc"), encryption);
const deps = {
  origin, credentials, fetch, modelsDev: new ModelsDevCatalog({ catalogPath: join(root, "apps/desktop/resources/models.dev/api.json") }),
  openExternal: async (url) => { authorizationUrl = new URL(url); },
  syncProviders: (input) => host.call("providers.syncMirrorCoding", input),
  completeWelcome: async () => { completedWelcome = true; }, changed() {},
};
let account = new MirrorCodingAccount(deps), relay = new MirrorCodingRelay(account);
const providers = async () => (await host.call("providers.list", { includeDisabled: true })).providers;
async function login() {
  await account.startLogin();
  const callback = new URL(authorizationUrl.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({ state: authorizationUrl.searchParams.get("state"), code: "fixture-code" });
  assert.equal((await fetch(callback)).status, 200);
  await until(() => account.snapshot().sync === "success" && account.snapshot().status === "connected", "login/catalog");
  await until(() => !account.snapshot().pendingRevocation, "prior grant revocation");
}
try {
  await host.handshake(); await login();
  let rows = await providers(), selected = rows.find((row) => row.enabled);
  check("PKCE login projects real Rust providers", completedWelcome && selected.mirrorCoding.accountId === 42);
  check("native protocols selected from declared capabilities", selected.mirrorCoding.routes["claude-sonnet-4-5"] === "anthropic" && selected.mirrorCoding.routes["gemini-2.5-flash"] === "gemini");
  check("unknown model retained without invented reasoning", selected.models.find((model) => model.id === "unlisted-model").thinkingLevels.length === 0);
  check("credentials encrypted on disk", !(await readFile(join(output, "credentials.enc"))).includes(Buffer.from(currentAccess)));
  const beforeCatalog = catalogReads;
  await Promise.all(Array.from({ length: 12 }, () => account.refreshCatalog()));
  check("simultaneous menu refreshes share catalog request", catalogReads === beforeCatalog + 1);
  catalogMode = "offline"; await account.refreshCatalog();
  check("temporary network failure retains account and models", account.snapshot().status === "connected" && account.snapshot().sync === "error" && (await providers()).some((row) => row.enabled));
  catalogMode = "normal"; await account.refreshCatalog();
  currentAccess = "expired-fixture-access";
  const beforeRefresh = refreshes;
  const concurrent = await Promise.all(Array.from({ length: 10 }, () => account.request("/probe", { method: "POST", body: "{}" })));
  check("concurrent 401 requests share one refresh", refreshes === beforeRefresh + 1 && concurrent.every((response) => response.ok));
  check("both rotated tokens saved", (await credentials.load()).active.refreshToken === `fixture-refresh-${generation}`);
  for (const [model, suffix] of [["gpt-5", "/responses"], ["claude-sonnet-4-5", "/v1/messages"], ["gemini-2.5-flash", "/models/gemini-2.5-flash:generateContent?key=sdk-key"]]) {
    const local = await relay.bind(selected.id, selected.mirrorCoding, model, "parent-session");
    const result = await fetch(`${local.baseUrl}${suffix}`, { method: "POST", headers: { ...local.headers, "x-api-key": "sdk-key", "x-goog-api-key": "sdk-key" }, body: JSON.stringify({ model, reasoning: { effort: "high" } }) });
    check(`${model} relay uses encoded group and Bearer only`, result.ok && requests.at(-1).group === encodeURIComponent("中文 % group") && !requests.at(-1).sdkAuth);
  }
  const local = await relay.bind(selected.id, selected.mirrorCoding, "gpt-5", "parent-session");
  const send = (signal) => fetch(`${local.baseUrl}/responses`, { method: "POST", headers: local.headers, body: JSON.stringify({ model: "gpt-5", stream: true }), signal });
  for (const status of [429, 503]) {
    nextFailure = status; const response = await send();
    check(`${status} and relay headers preserved`, response.status === status && response.headers.get("retry-after") === "2" && response.headers.get("x-oneapi-request-id") === "oneapi-fixture" && response.headers.get("x-upstream-request-id") === "upstream-fixture" && response.headers.get("x-request-id") === "request-fixture" && response.headers.get("request-id") === "generic-fixture" && account.snapshot().status === "connected");
  }
  denyGroup = true; const denied = await send();
  await until(() => account.snapshot().error === "model_or_group_unavailable", "permission refresh notice");
  check("permission change refreshes and requests explicit selection", denied.status === 403);
  denyGroup = false; await account.refreshCatalog();
  streaming = true; const abort = new AbortController(), response = await send(abort.signal);
  const reader = response.body.getReader(); const partial = await reader.read(); abort.abort();
  await until(() => disconnected && !relay.hasActiveRequests(), "upstream cancellation");
  check("streaming data and stop propagate upstream", new TextDecoder().decode(partial.value).includes("partial"));
  streaming = false;
  catalogMode = "empty"; await account.refreshCatalog();
  check("successful empty catalog disables choices", (await providers()).every((row) => !row.enabled));
  const unavailable = await send(); check("old binding cannot call removed group", unavailable.status === 403);
  catalogMode = "normal"; await account.refreshCatalog();
  check("same account group identity survives resync", (await providers()).find((row) => row.enabled).id === selected.id);
  await account.startLogin(); const cancelUrl = authorizationUrl.searchParams.get("redirect_uri"); account.cancelLogin();
  await assert.rejects(fetch(cancelUrl)); check("cancel closes callback listener");
  await login(); check("same account reauthorization reuses group", (await providers()).find((row) => row.enabled).id === selected.id);
  accountId = 43; await login();
  rows = await providers(); check("account switch disables historical groups", !rows.find((row) => row.id === selected.id).enabled && rows.some((row) => row.enabled && row.mirrorCoding.accountId === 43));
  account.dispose(); relay.dispose(); account = new MirrorCodingAccount(deps); relay = new MirrorCodingRelay(account); await account.initialize();
  check("restart restores encrypted account", account.snapshot().account.id === 43);
  revokeUnavailable = true; await account.logout();
  check("offline logout retains only revoke record", account.snapshot().status === "signed_out" && account.snapshot().pendingRevocation && !(await credentials.load()).active);
  revokeUnavailable = false; await account.retryRevocation();
  check("server revocation can be retried", !account.snapshot().pendingRevocation && revoked.length > 0);
  await login(); expired = true; currentAccess = "expired-fixture-access";
  await assert.rejects(account.request("/probe"));
  check("invalid grant requests reauthorization", account.snapshot().status === "reauthorize");
  const timeoutFlow = await beginAuthorization(origin, fetch, 30);
  await assert.rejects(timeoutFlow.completion, /authorization_timed_out/);
  await assert.rejects(fetch(new URL(timeoutFlow.url).searchParams.get("redirect_uri")));
  check("authorization timeout closes callback listener");
  const unavailableStorage = new MirrorCodingCredentials(join(output, "unavailable.enc"), { ...encryption, isEncryptionAvailable: () => false });
  assert.throws(() => unavailableStorage.assertAvailable(), /secure_storage_unavailable/);
  check("unavailable secure storage is explicit");
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify({ passed, requests, refreshes, catalogReads }, null, 2));
  account.dispose(); relay.dispose(); server.closeAllConnections(); server.close(); await host.dispose(); await vite.close();
  console.log(`Recovery artifacts: ${output}`);
}
