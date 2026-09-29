import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { mobileFixture } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = join(root, ".artifacts", "response-recovery-" + Date.now());
await mkdir(join(output, "workspace"), { recursive: true });
const modelId = "claude-opus-5.5-thinking";
const requests = [], passed = [], errors = [];
let steps = [], desktop, browser, page, phone, credentials, held;
const fixture = await mobileFixture({ messageHandler: async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ path: req.url, body, group: req.headers["x-mirrorcoding-group"], bearer: req.headers.authorization === "Bearer fixture-access", sdkKey: Boolean(req.headers["x-api-key"]) });
  const step = steps.shift();
  if (!step) { res.writeHead(403).end(JSON.stringify({ error: { message: "Unexpected replay" } })); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream", "request-id": "controlled-native-request" });
  const emit = (type, fields = {}) => res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...fields }) + "\n\n");
  emit("message_start", { message: { id: "fixture-native", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } });
  if (step === "thinking") {
    emit("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } });
    emit("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "NATIVE_THINKING_RETAINED" } });
    emit("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "native-fixture-signature" } });
    emit("content_block_stop", { index: 0 });
  } else if (step !== "empty") {
    emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: step === "success" ? "NATIVE_CONTINUED" : "NATIVE_PARTIAL_RETAINED" } });
    if (step === "hold") { held = res; res.on("close", () => { held = undefined; }); return; }
    if (step === "interrupted") { res.end(); return; }
    emit("content_block_stop", { index: 0 });
  }
  emit("message_delta", { delta: { stop_reason: step === "length" ? "max_tokens" : "end_turn", stop_sequence: null }, usage: { output_tokens: step === "empty" ? 0 : 8 } });
  emit("message_stop"); res.end();
} });
fixture.upstream.catalog.groups[0].models.push({ id: modelId, supported_endpoint_types: ["openai"] });
const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
process.env.VITE_MC_ORIGIN = fixture.origin;
const vite = await createServer({ root: join(root, "apps/mobile"), mode: "acceptance", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
await vite.listen();
const check = (label, value = true) => { assert(value, label); passed.push(label); console.log("PASS " + label); };
async function until(probe, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await new Promise(done => setTimeout(done, 100)); }
  throw new Error("Timed out: " + label);
}
const invoke = (name, ...args) => page.evaluate(async ({ name, args }) => {
  const result = await window.piDesktop.invoke("pi-desktop/" + name, ...args);
  if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.data;
}, { name, args });
const view = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot());
async function openDesktop() {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "data"), PI_DESKTOP_HOST_BIN: join(root, "target/debug/pi-desktop-host-core.exe"), PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), "--user-data-dir=" + join(output, "profile")], env, timeout: 60000 });
  page = await until(async () => { for (const candidate of desktop.windows()) if (await candidate.locator(".app-shell").count()) return candidate; }, "desktop", 60000);
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
}
async function closeDesktop() { if (desktop) { await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; }); await desktop.close(); desktop = undefined; } }
async function shot(name) {
  await page.getByTestId("startup-splash").waitFor({ state: "hidden" });
  await page.screenshot({ path: join(output, name + "-desktop.png") });
  await phone.screenshot({ path: join(output, name + "-mobile.png"), fullPage: true });
  check(name + " fits phone width", await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
try {
  await openDesktop();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__authUrl = url; }; });
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  await fetch(await until(() => desktop.evaluate(() => globalThis.__authUrl), "authorization"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "catalog");
  const provider = (await invoke("providers/list")).providers.find(p => p.mirrorCoding?.scope === "account");
  assert(provider, "Controlled MC group exists");
  await invoke("providers/update", { id: provider.id, models: provider.models.map(m => m.id === modelId ? { ...m, mirrorCodingGroupId: "中文 分组", thinkingLevels: ["max"], defaultThinkingLevel: "max", availableForSubagents: true, maxTokens: 8192 } : m) });
  await invoke("settings/set", { ...await invoke("settings/get"), defaultProviderId: provider.id, defaultModelId: modelId, language: "en", autoGenerateTitle: false, theme: "dark" });
  const { session } = await invoke("session/create", { title: "Response recovery QA", projectPath: join(output, "workspace"), mode: "agent", providerId: provider.id, modelId, thinkingLevel: "max" });
  await invoke("project/set", session.projectPath);
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), session.id);
  await page.locator('[data-sidebar-session-row="' + session.id + '"]').first().click({ button: "right" });
  await page.locator('[data-action="sync-session-mobile"]').click();
  const code = await until(async () => (await page.locator('[data-testid="mobile-pairing-code"]').textContent().catch(() => ""))?.trim(), "pairing code");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "en-US" });
  await context.exposeBinding("testCredentialRead", () => credentials ?? null);
  await context.exposeBinding("testCredentialWrite", (_source, value) => { credentials = value; });
  await context.exposeBinding("testCredentialClear", () => { credentials = undefined; });
  await context.addInitScript(() => { window.__PI_MOBILE_TEST__ = { credentialStore: { read: () => window.testCredentialRead(), write: value => window.testCredentialWrite(value), clear: () => window.testCredentialClear() } }; });
  phone = await context.newPage(); await phone.goto(vite.resolvedUrls.local[0]);
  await phone.locator('[name="username"]').fill("mobileqa"); await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator('.login-form button[type="submit"]').click();
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code); await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".grant-open").filter({ hasText: "Response recovery QA" }).click();
  await page.locator('[data-action="close-mobile-pairing"]').click();
  async function send(step) {
    steps = step === "empty" ? ["empty", "empty"] : [step]; const before = requests.length;
    const previousMessages = new Set((await view()).messages.map(message => message.id));
    await phone.locator(".composer textarea").fill("Controlled " + step + " response");
    await phone.getByRole("button", { name: "Send", exact: true }).click();
    const message = await until(async () => {
      const current = await view();
      const reply = current.messages.filter(message => message.role === "assistant").at(-1);
      // An idle snapshot can precede the relay event for this submission.
      // Wait for its new terminal row, not the previous response.
      return requests.length > before && !current.busy && !current.snapshot?.activeTurn &&
        reply && !previousMessages.has(reply.id) && ["error", "complete", "aborted"].includes(reply.status) && reply;
    }, "terminal response " + step);
    return { before, message };
  }
  const first = await send("thinking");
  check("MC Claude uses native Messages with exact model, Bearer, encoded group and no SDK key", requests[0].path.startsWith("/v1/messages") && requests[0].body.model === modelId && requests[0].bearer && !requests[0].sdkKey && decodeURIComponent(requests[0].group) === "中文 分组");
  check("thinking-only is retained without replay", requests.length === first.before + 1 && first.message.error.code === "MODEL_THINKING_ONLY" && first.message.thinking === "NATIVE_THINKING_RETAINED");
  check("native max is sent unchanged", requests[0].body.output_config?.effort === "max" && requests[0].body.thinking?.type === "adaptive" && !requests[0].body.thinking.budget_tokens);
  check("diagnostics report the selected group and upstream path", first.message.responseDiagnostics?.group === "中文 分组" && first.message.responseDiagnostics.path === "/v1/messages");
  await phone.getByText("Thinking", { exact: true }).last().click();
  await phone.getByText("NATIVE_THINKING_RETAINED", { exact: true }).waitFor();
  await shot("thinking-dark-en");
  await closeDesktop(); await openDesktop();
  await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), session.id);
  await until(async () => (await view()).connection === "connected", "reconnect after desktop restart", 60000);
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  await phone.locator(".composer textarea").fill("Keep this unsent draft");
  steps = ["success"];
  await phone.getByRole("button", { name: "Continue", exact: true }).last().click();
  await phone.getByText("NATIVE_CONTINUED", { exact: true }).last().waitFor();
  await until(async () => !(await view()).snapshot?.activeTurn, "continuation idle");
  const detail = (await invoke("session/get", { id: session.id })).session;
  check("restart and explicit Continue retain the prior thought and append a user turn", detail.messages.some(m => m.id === first.message.id && m.thinking === "NATIVE_THINKING_RETAINED") && detail.messages.filter(m => m.role === "user").length === 2 && JSON.stringify(requests.at(-1).body.messages).includes("native-fixture-signature"));
  check("mobile Continue preserves an unsent draft", await phone.locator(".composer textarea").inputValue() === "Keep this unsent draft");
  for (const [step, error] of [["length", "MODEL_OUTPUT_TRUNCATED"], ["interrupted", "STREAM_FAILED"], ["empty", "EMPTY_MODEL_RESPONSE"]]) {
    const run = await send(step);
    check(step + " has bounded requests and the correct visible classification", requests.length - run.before === (step === "empty" ? 2 : 1) && run.message.error.code === error);
    if (step !== "empty") check(step + " keeps partial output", run.message.content === "NATIVE_PARTIAL_RETAINED");
    await shot(step + "-dark-en");
  }
  await send("thinking"); steps = ["success"];
  await page.getByRole("button", { name: "Continue", exact: true }).last().click();
  await until(async () => (await view()).messages.filter(m => m.content === "NATIVE_CONTINUED").length === 2, "desktop Continue syncs to phone");
  check("desktop Continue appends and synchronizes to the phone");
  steps = ["hold"]; const beforeStop = requests.length;
  await phone.locator(".composer textarea").fill("Controlled stop"); await phone.getByRole("button", { name: "Send", exact: true }).click();
  await until(() => Boolean(held), "partial live response");
  await phone.getByRole("button", { name: "Stop", exact: true }).click();
  await until(async () => {
    const current = await view();
    return !current.snapshot?.activeTurn && current.messages.filter(message => message.role === "assistant").at(-1)?.status === "aborted";
  }, "stopped");
  check("user Stop retains cancellation without replay", requests.length === beforeStop + 1 && (await view()).messages.filter(m => m.role === "assistant").at(-1).status === "aborted");
  await shot("stopped");
  await send("thinking");
  await phone.getByRole("button", { name: "Account and appearance", exact: true }).click();
  await phone.getByRole("button", { name: "Light", exact: true }).click();
  await phone.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await phone.keyboard.press("Escape");
  await phone.getByRole("button", { name: "继续", exact: true }).last().waitFor();
  await invoke("settings/set", { ...await invoke("settings/get"), theme: "light", language: "zh-CN" });
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.evaluate(id => window.__PI_DESKTOP__.selectSession(id), session.id);
  await page.getByRole("button", { name: "继续", exact: true }).last().waitFor();
  const localizedError = "模型只返回了思考，没有生成回答。已保留现有内容，可点击“继续”请求回答。";
  await page.getByText(localizedError, { exact: true }).last().waitFor();
  await phone.getByText(localizedError, { exact: true }).last().waitFor();
  await page.getByTestId("startup-splash").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "继续", exact: true }).last().click({ trial: true });
  await phone.getByRole("button", { name: "继续", exact: true }).last().click({ trial: true });
  await shot("thinking-light-zh");
  check("Chinese Continue is available in light theme on both clients", await phone.locator("html").getAttribute("data-theme") === "light");
} catch (error) {
  errors.push(String(error.stack ?? error)); process.exitCode = 1;
  if (page) await page.screenshot({ path: join(output, "failure-desktop.png") }).catch(() => {});
  if (phone) await phone.screenshot({ path: join(output, "failure-mobile.png") }).catch(() => {});
  console.error(error);
} finally {
  held?.end(); await browser?.close(); await closeDesktop(); await vite.close(); await fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), passed, errors, requestCount: requests.length }, null, 2));
  console.log("ARTIFACTS " + output);
}
