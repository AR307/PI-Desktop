// Session attention push: desktop approvals, questions, completions and
// failures reach a paired phone as in-app toasts while it is visible and as
// system notifications while it is backgrounded. Uses the real Electron
// desktop, Rust host and Node agent with the controlled MC fixture; the phone
// runs in Chromium with an acceptance-only notification recorder.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { mobileFixture } from "./fixture.mjs";
import { openTab } from "./phone-ui.mjs";

const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mobile-attention-${Date.now()}`));
const revision = () => ({
  candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  workspace: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim(),
});
const startedRevision = revision();
await mkdir(output, { recursive: true });
const fixture = await mobileFixture();
process.env.VITE_MC_ORIGIN = fixture.origin;
const vite = await createServer({ root: join(root, "apps/mobile"), mode: "acceptance", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
await vite.listen();
const mobileOrigin = vite.resolvedUrls.local[0];
const passed = [], errors = [], cleanupErrors = [];
let desktop, page, browser, phone, closing = false, savedCredentials;
const check = (label, result = true) => { assert(result, label); passed.push(label); console.log(`PASS ${label}`); };
const until = async (probe, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
const view = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot());
const recorded = () => phone.evaluate(() => ({ ...window.__PI_MOBILE_TEST__.notifications, tap: undefined }));
const inbox = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.attention.items.map((item) => ({ ...item })));
const setVisible = (visible) => phone.evaluate((visible) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}, visible);

async function screenshot(name) {
  await phone.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
  await phone.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  check(`${name}: fits viewport`, await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function openDesktop() {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "profile"), PI_DESKTOP_HOST_BIN: process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe"), PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`], env, timeout: 60_000 });
  page = await until(async () => { for (const candidate of desktop.windows()) if (await candidate.locator(".app-shell").count()) return candidate; }, "desktop shell", 60_000);
  page.setDefaultTimeout(20_000); page.on("pageerror", (error) => { if (!closing) errors.push({ surface: "desktop", message: error.message, after: passed.at(-1) }); });
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__authUrl = url; }; });
}
async function openPhone() {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: "dark" });
  await context.exposeBinding("testCredentialRead", () => savedCredentials ?? null);
  await context.exposeBinding("testCredentialWrite", (_source, value) => { savedCredentials = value; });
  await context.exposeBinding("testCredentialClear", () => { savedCredentials = undefined; });
  await context.addInitScript(() => {
    window.__PI_MOBILE_TEST__ = {
      credentialStore: { read: () => window.testCredentialRead(), write: (value) => window.testCredentialWrite(value), clear: () => window.testCredentialClear() },
      notifications: { shown: [], cleared: [], keepAlive: [] },
    };
  });
  phone = await context.newPage(); phone.setDefaultTimeout(20_000);
  phone.on("pageerror", (error) => errors.push({ surface: "mobile", message: error.message, after: passed.at(-1) }));
  await phone.goto(mobileOrigin);
}
async function desktopSend(sessionId, text) {
  await page.locator(`[data-sidebar-session-row="${sessionId}"] .thread-item-main`).first().click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill(text); await editor.press("Enter");
}
const idle = async (sessionId) => {
  const state = await invoke("agent/pendingInteractive", { sessionId });
  const session = (await invoke("session/get", { id: sessionId })).session;
  return !state.permissions.length && !state.asks.length && session.messages.some((message) => message.role === "assistant" || message.role === "tool");
};

try {
  await openDesktop();
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  await fetch(await until(() => desktop.evaluate(() => globalThis.__authUrl), "desktop browser authorization"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "MC catalog login");
  const provider = (await invoke("providers/list")).providers.find((item) => item.mirrorCoding?.groupId === "中文 分组");
  await invoke("settings/set", { ...await invoke("settings/get"), defaultProviderId: provider.id, defaultModelId: "gpt-5", language: "en", theme: "dark" });
  const projectPath = join(output, "attention-workspace");
  await mkdir(projectPath, { recursive: true });
  const shared = (await invoke("session/create", { title: "Attention shared session", projectPath, providerId: provider.id, modelId: "gpt-5", mode: "agent" })).session;
  const unshared = (await invoke("session/create", { title: "Attention private session", projectPath, providerId: provider.id, modelId: "gpt-5", mode: "agent" })).session;
  for (const session of [shared, unshared]) await invoke("session/configure", session.id, { providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "agent" });
  await invoke("project/set", projectPath);
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();

  await page.locator(`[data-sidebar-session-row="${shared.id}"]`).first().click({ button: "right" });
  await page.locator('[data-action="sync-session-mobile"]').click();
  await page.locator('[data-testid="mobile-pairing-code"]').waitFor();
  const code = (await page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();

  await openPhone();
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("heading", { name: "Sessions", exact: true }).waitFor();
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".session-card").filter({ hasText: "Attention shared session" }).waitFor();
  await page.locator('[data-action="close-mobile-pairing"]').click();
  const desktopId = (await view()).directories[0].desktopDeviceId;
  const tag = `session:${desktopId}:${shared.id}`;
  check("paired phone lists only the shared session", (await view()).directories[0].sessions.every((session) => session.id !== unshared.id));

  // Visible phone, another screen: an in-app toast, the inbox and the list status update; no system notification.
  await desktopSend(shared.id, "mobile-approval run a harmless command");
  await phone.locator(".toast").filter({ hasText: "Approval needed · Attention shared session" }).waitFor();
  await phone.locator(".session-card.attention").filter({ hasText: "Attention shared session" }).getByText("Approval needed", { exact: true }).waitFor();
  check("desktop approval reaches the visible phone as a toast and a needs-you row");
  check("a visible phone raises no system notification", (await recorded()).shown.length === 0);
  check("activity badge counts the unread ask", await phone.locator(".tab-badge").textContent() === "1");
  await screenshot("attention-toast-dark-en");
  const permission = await until(async () => (await invoke("agent/pendingInteractive", { sessionId: shared.id })).permissions[0], "desktop permission request");
  await invoke("tool/resolvePermission", { requestId: permission.requestId, decision: "allow-once" });
  await until(async () => (await inbox()).some((item) => item.kind === "completed" && item.sessionId === shared.id), "completion after desktop approval");
  check("answering on the desktop marks the phone's ask handled", (await inbox()).find((item) => item.kind === "approval").resolved === true);
  await until(async () => !(await phone.locator(".session-card.attention").count()), "needs-you row cleared");
  await openTab(phone, "Activity");
  await phone.locator(".activity-row").getByText("Done · Attention shared session", { exact: true }).waitFor();
  await screenshot("attention-activity-dark-en");

  // Backgrounded phone: system notifications, smart keep-alive and resolution cleanup.
  await setVisible(false);
  await desktopSend(shared.id, "mobile-slow keep the phone connected");
  // The previous task's grace period may already hold keep-alive with the idle text.
  await until(async () => { const last = (await recorded()).keepAlive.at(-1); return last?.enabled === true && last.body === "Tasks in progress: 1"; }, "smart keep-alive while desktop work runs");
  check("smart keep-alive follows running desktop work");
  fixture.releaseChats();
  const completed = await until(async () => (await recorded()).shown.find((item) => item.title === "Done · Attention shared session"), "background completion notification");
  check("background completion raises a result notification with route and computer", completed.channel === "results" && completed.tag === tag && completed.route.sessionId === shared.id && completed.route.desktopId === desktopId && completed.body === "Working on the computer. Mobile task completed." && typeof completed.subtitle === "string");
  await until(async () => await idle(shared.id), "slow task settled");

  await desktopSend(shared.id, "mobile-fail please");
  const failed = await until(async () => (await recorded()).shown.find((item) => item.title === "Failed · Attention shared session"), "background failure notification");
  check("background failure raises a result notification with the error", failed.channel === "results" && failed.body.length > 0);

  await desktopSend(shared.id, "mobile-question choose a color");
  const asked = await until(async () => (await recorded()).shown.find((item) => item.title === "Question · Attention shared session"), "background question notification");
  check("background question raises an attention notification", asked.channel === "attention" && asked.body === "Choose the mobile acceptance color");
  const clearedBefore = (await recorded()).cleared.length;
  const ask = await until(async () => (await invoke("agent/pendingInteractive", { sessionId: shared.id })).asks[0], "desktop ask");
  await invoke("agent/askTool/resolve", { requestId: ask.requestId, sessionId: shared.id, answers: [["Blue"]] });
  await until(async () => (await recorded()).cleared.slice(clearedBefore).includes(tag), "answered question clears its notification");
  check("an ask answered elsewhere clears the phone notification");

  // Unshared sessions never reach the phone.
  const shownBefore = (await recorded()).shown.length;
  await desktopSend(unshared.id, "mobile-fail in the private session");
  await until(async () => (await invoke("session/get", { id: unshared.id })).session.messages.some((message) => message.role === "user"), "private session ran");
  await pause(2500);
  check("activity in an unshared session never reaches the phone", (await recorded()).shown.length === shownBefore && !(await inbox()).some((item) => item.sessionId === unshared.id));

  // Tapping a notification opens its conversation and marks it read.
  await phone.evaluate((route) => window.__PI_MOBILE_TEST__.notifications.tap(route), { desktopId, sessionId: shared.id });
  await phone.locator(".conversation-heading strong").filter({ hasText: "Attention shared session" }).waitFor();
  await until(async () => (await view()).selectedId === shared.id, "notification tap opened the session");
  await setVisible(true);
  await until(async () => (await inbox()).filter((item) => item.sessionId === shared.id).every((item) => item.read), "opened session marked read");
  check("a notification tap opens the conversation and reads its activity");

  // Revocation stops delivery.
  const grant = (await invoke("mobile-sync/status")).grants[0];
  await invoke("mobile-sync/revoke", grant.id);
  await until(async () => (await view()).directories.length === 0, "phone learns about revocation", 40_000);
  const afterRevoke = (await recorded()).shown.length;
  await setVisible(false);
  await desktopSend(shared.id, "Desktop work after revocation");
  await pause(2500);
  check("revoked access stops attention delivery and forgets the inbox", (await recorded()).shown.length === afterRevoke && !(await inbox()).some((item) => item.sessionId === shared.id));
  await setVisible(true);
  check("no missing translation keys", (await phone.evaluate(() => window.__PI_MOBILE_MISSING_KEYS__ ?? [])).length === 0);
  check("no renderer exceptions", errors.length === 0);
} catch (error) {
  errors.push({ message: error.stack }); console.error(error);
  await page?.screenshot({ path: join(output, "desktop-failure.png") }).catch(() => undefined);
  await phone?.screenshot({ path: join(output, "mobile-failure.png") }).catch(() => undefined);
  if (phone) await writeFile(join(output, "mobile-state.json"), JSON.stringify({ view: await view().catch(() => null), recorded: await recorded().catch(() => null), inbox: await inbox().catch(() => null) }, null, 2));
  process.exitCode = 1;
} finally {
  closing = true;
  await desktop?.close().catch((error) => cleanupErrors.push(error.message));
  await browser?.close().catch((error) => cleanupErrors.push(error.message));
  await vite.close().catch((error) => cleanupErrors.push(error.message)); fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ startedRevision, finishedRevision: revision(), passed, errors, cleanupErrors }, null, 2));
  console.log(`Mobile attention artifacts: ${output}`);
}
