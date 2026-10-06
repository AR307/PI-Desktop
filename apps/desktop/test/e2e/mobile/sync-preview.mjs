import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { HostProcess } from "@pi-desktop/host-runtime";
import { mobileFixture } from "./fixture.mjs";

const root = resolve(import.meta.dirname, "../../../../..");
const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `sync-preview-${Date.now()}`));
await mkdir(output, { recursive: true });
const profile = join(output, "profile");
const binaryPath = process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe");
const fixture = await mobileFixture();
process.env.VITE_MC_ORIGIN = fixture.origin;
const vite = await createServer({ root: join(root, "apps/mobile"), mode: "acceptance", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
await vite.listen();
const passed = [], errors = [];
let desktop, page, browser, phone, savedCredentials, shared;
const check = (name, value = true) => { assert(value, name); passed.push(name); console.log(`PASS ${name}`); };
const until = async (probe, label) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await new Promise(done => setTimeout(done, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
async function openDesktop() {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: profile, PI_DESKTOP_HOST_BIN: binaryPath, PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`], env, timeout: 60_000 });
  page = await until(async () => { for (const candidate of desktop.windows()) if (await candidate.locator(".app-shell").count()) return candidate; }, "desktop shell");
  page.setDefaultTimeout(25_000);
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__authUrl = url; }; });
}
async function closeDesktop() {
  if (!desktop) return;
  await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await desktop.close(); desktop = undefined;
}
async function share() {
  await page.locator(`[data-sidebar-session-row="${shared.id}"]`).first().click({ button: "right" });
  await page.locator('[data-action="sync-session-mobile"]').click();
}
const registrations = () => fixture.calls.filter(call => call.path.endsWith("/devices/register")).length;
async function completeAuthorization(url) {
  // Exercise both local HTTP endpoints, including OS-assigned callback ports.
  const location = await new Promise((resolve, reject) => get(url, response => { response.resume(); resolve(response.headers.location); }).on("error", reject));
  await new Promise((resolve, reject) => get(location, response => { response.resume(); response.on("end", resolve); }).on("error", reject));
}
try {
  const host = new HostProcess({ binaryPath, dataDir: profile, onStderr() {} });
  try {
    await host.handshake();
    shared = (await host.call("session.create", { title: "Scratch pelican preview", mode: "agent" })).session;
    const scratch = join(profile, "scratch", shared.id);
    await mkdir(scratch, { recursive: true });
    await writeFile(join(scratch, "pelican.html"), '<!doctype html><meta charset="utf-8"><title>Pelican bicycle preview</title><style>body{font:24px system-ui;background:#eee;padding:48px}#bird{font-size:80px;animation:ride 2s infinite alternate}@keyframes ride{to{transform:translateX(100px)}}</style><h1>Pelican bicycle preview</h1><div id="bird">🚲</div><button onclick="this.textContent=\'Animation opened\'">Test animation</button>');
    await host.call("session.appendMessage", { sessionId: shared.id, message: { id: randomUUID(), role: "assistant", content: "[Open pelican bicycle animation](pelican.html)", status: "complete", createdAt: new Date().toISOString() } });
    await host.call("settings.set", { language: "en", theme: "dark" });
  } finally { await host.dispose(); }
  await openDesktop();
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  await completeAuthorization(await until(() => desktop.evaluate(() => globalThis.__authUrl), "authorization URL"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "authorized catalog");
  await page.locator(`[data-sidebar-session-row="${shared.id}"] .thread-item-main`).first().click();
  fixture.control.rateLimitOnce = "/api/pi-sync/devices/register";
  await share();
  await page.getByRole("alert").filter({ hasText: "rate limited" }).waitFor();
  check("desktop pairing surfaces HTTP 429 instead of a generic connection error");
  await page.screenshot({ path: join(output, "desktop-rate-limited.png") });
  check("desktop pairing cannot be retried before Retry-After", await page.locator('[data-action="regenerate-mobile-pairing"]').isDisabled());
  await until(async () => !await page.locator('[data-action="regenerate-mobile-pairing"]').isDisabled(), "pairing cooldown");
  await page.locator('[data-action="regenerate-mobile-pairing"]').click();
  await page.locator('[data-testid="mobile-pairing-code"]').waitFor();
  const code = (await page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();
  check("server-issued device identity creates an eight-digit pairing", /^\d{8}$/.test(code));
  const registeredCount = registrations();
  await Promise.all([invoke("mobile-sync/refresh"), invoke("mobile-sync/refresh")]);
  check("desktop refresh reuses encrypted installation identity", registrations() === registeredCount);
  check("desktop renderer sees no device secret", !JSON.stringify(await invoke("mobile-sync/status")).includes("deviceSecret"));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: "dark" });
  await context.exposeBinding("testCredentialRead", () => savedCredentials ?? null);
  await context.exposeBinding("testCredentialWrite", (_source, value) => { savedCredentials = value; });
  await context.exposeBinding("testCredentialClear", () => { savedCredentials = undefined; });
  await context.addInitScript(() => { window.__PI_MOBILE_TEST__ = { credentialStore: { read: () => window.testCredentialRead(), write: value => window.testCredentialWrite(value), clear: () => window.testCredentialClear() } }; });
  phone = await context.newPage(); phone.setDefaultTimeout(25_000);
  await phone.goto(vite.resolvedUrls.local[0]);
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  fixture.control.rateLimitOnce = "/api/pi-mobile/auth/login";
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("alert").filter({ hasText: "rate limited" }).waitFor();
  check("phone explains login rate limit and retry time", (await phone.getByRole("alert").textContent()).includes("Try again after"));
  await phone.screenshot({ path: join(output, "phone-rate-limited.png") });
  await until(async () => phone.evaluate(() => Date.now() >= window.__PI_MOBILE_CONTROLLER__.getSnapshot().retryAt), "phone cooldown");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("heading", { name: "Shared work", exact: true }).waitFor();
  check("phone saves the device secret with its login", typeof JSON.parse(savedCredentials).deviceSecret === "string");
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".grant-open").filter({ hasText: shared.title }).waitFor();
  await page.getByText("Device paired. Your phone can now view and continue this work.", { exact: true }).waitFor();
  check("visible desktop and phone interfaces pair the same session");
  await page.locator('[data-action="close-mobile-pairing"]').click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const beforeRestart = registrations();
  await phone.reload();
  await phone.locator(".grant-open").filter({ hasText: shared.title }).waitFor();
  await closeDesktop(); await openDesktop();
  await until(async () => (await invoke("mobile-sync/status")).status === "online", "restored desktop relay");
  check("both clients restart without another device registration", registrations() === beforeRestart);
  fixture.expireMobileAccess();
  await phone.getByRole("button", { name: "Refresh", exact: true }).click();
  await until(() => fixture.control.mobileRefreshes === 1, "phone refresh");
  check("rotated mobile tokens retain installation secret", typeof JSON.parse(savedCredentials).deviceSecret === "string");
  await phone.locator(".grant-open").filter({ hasText: shared.title }).click();
  await phone.getByText("Open pelican bicycle animation", { exact: true }).waitFor();
  check("phone restores the shared history after restart");
  await phone.screenshot({ path: join(output, "phone-restored-history.png") });

  await page.locator(`[data-sidebar-session-row="${shared.id}"] .thread-item-main`).first().click();
  await page.getByText("Open pelican bicycle animation", { exact: true }).click();
  const guest = await until(async () => desktop.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getURL().startsWith("file:") && wc.getURL().endsWith("pelican.html"))?.id), "scratch browser guest");
  check("temporary-session HTML link opens a real native browser page");
  check("preview is interactive", await desktop.evaluate(async ({ webContents }, id) => {
    const wc = webContents.fromId(id);
    return wc.executeJavaScript("document.querySelector('button').click();document.querySelector('button').textContent === 'Animation opened'");
  }, guest));
  await until(() => desktop.evaluate(({ BrowserWindow }, id) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(child => child.webContents?.id === id);
    return view && view.getVisible() && view.getBounds().width > 100 && view.getBounds().height > 100;
  }, guest), "visible native browser bounds");
  check("native browser guest is attached and visible in the work panel");
  await page.screenshot({ path: join(output, "desktop-scratch-browser.png") });
  const native = await desktop.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toDataURL());
  await writeFile(join(output, "desktop-native-preview.png"), Buffer.from(native.split(",")[1], "base64"));
  const windowCapture = await desktop.evaluate(async ({ desktopCapturer, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const source = (await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1920, height: 1080 } }))
      .find(source => source.id === win.getMediaSourceId());
    return source?.thumbnail.toDataURL();
  });
  assert(windowCapture, "native window capture is available");
  await writeFile(join(output, "desktop-window-preview.png"), Buffer.from(windowCapture.split(",")[1], "base64"));
  check("local fixture required no paid model requests", fixture.chats.length === 0);
  await invoke("mirrorcoding/logout", true);
  check("explicit desktop logout clears device and local sharing scopes", !(await invoke("settings/get")).mobileSync && !(await invoke("mobile-sync/status")).deviceId);
} catch (error) { errors.push(error.stack ?? String(error)); console.error(error); process.exitCode = 1; }
finally {
  await closeDesktop().catch(error => errors.push(String(error)));
  await browser?.close(); await vite.close(); fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), passed, errors }, null, 2));
  console.log(`Evidence: ${output}`);
  if (errors.length) process.exitCode = 1;
}
