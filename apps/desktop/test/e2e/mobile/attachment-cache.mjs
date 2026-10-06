import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { HostProcess } from "@pi-desktop/host-runtime";
import { mobileFixture } from "./fixture.mjs";

// Controlled desktop, relay, IndexedDB and phone-browser attachment acceptance.
const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mobile-attachment-cache-${Date.now()}`));
const hostBinary = process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe");
const profile = join(output, "profile");
const revision = () => ({
  candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  base: execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(),
  workspace: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim(),
});
const startedRevision = revision();
const passed = [], errors = [], cleanupErrors = [];
const check = (label, result) => { assert(result, label); passed.push(label); console.log(`PASS ${label}`); };
const until = async (probe, label, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await new Promise(done => setTimeout(done, 100)); }
  throw new Error(`Timed out: ${label}`);
};
await mkdir(output, { recursive: true });
const fixture = await mobileFixture();
process.env.VITE_MC_ORIGIN = fixture.origin;
const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
const vite = await createServer({ root: join(root, "apps/mobile"), mode: "acceptance", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
await vite.listen();
let desktop, page, browser, phone, phoneContext, credentials;
const view = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot());
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
const attachmentCount = () => phone.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("pi.mobile.transcripts");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const request = db.transaction("attachments").objectStore("attachments").count();
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = () => { reject(request.error); db.close(); };
  };
}));
async function openSession(sessionId) {
  await phone.locator(".grant-open").first().click();
  await phone.locator(".session-card").filter({ hasText: "Cached image session" }).click();
  await until(async () => (await view()).selectedId === sessionId && !(await view()).loading, "shared session open");
}
try {
  const projectPath = join(output, "project");
  await mkdir(projectPath, { recursive: true });
  const imagePath = join(projectPath, "controlled-image.png");
  await writeFile(imagePath, fixture.upstream.bytes);
  const host = new HostProcess({ binaryPath: hostBinary, dataDir: profile, onStderr() {} });
  let session;
  try {
    await host.handshake();
    session = (await host.call("session.create", { title: "Cached image session", projectPath, mode: "agent" })).session;
    await host.call("session.appendMessage", { sessionId: session.id, message: {
      id: "controlled-image-message", role: "assistant", content: "A controlled image attachment", status: "complete",
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      attachments: [{ kind: "image", name: "controlled-image.png", ref: imagePath, mimeType: "image/png", size: fixture.upstream.bytes.length }],
    } });
    await host.call("settings.set", { language: "en", theme: "dark" });
  } finally { await host.dispose(); }

  const env = { ...process.env, PI_DESKTOP_DATA_DIR: profile, PI_DESKTOP_HOST_BIN: hostBinary, PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`], env, timeout: 60_000 });
  page = await until(async () => { for (const candidate of desktop.windows()) if (await candidate.locator(".app-shell").count()) return candidate; }, "desktop shell", 60_000);
  page.setDefaultTimeout(20_000);
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__attachmentAuth = url; }; });
  await page.getByRole("dialog").getByRole("button", { name: /Sign in with MirrorCoding/ }).click();
  await fetch(await until(() => desktop.evaluate(() => globalThis.__attachmentAuth), "controlled desktop login"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "desktop login");
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator('[data-nav="settings"]').click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.locator('[data-testid="mobile-sync-settings"]').waitFor();
  await page.getByRole("switch", { name: "Share this computer's projects", exact: true }).click();
  await until(async () => (await invoke("mobile-sync/status")).accountSyncEnabled, "desktop opted in");
  await page.getByRole("button", { name: "Pair account", exact: true }).click();
  const code = (await page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();

  browser = await chromium.launch({ headless: true });
  phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: "dark" });
  await phoneContext.exposeBinding("readTestCredential", () => credentials ?? null);
  await phoneContext.exposeBinding("saveTestCredential", (_source, value) => { credentials = value; });
  await phoneContext.exposeBinding("clearTestCredential", () => { credentials = undefined; });
  await phoneContext.addInitScript(() => { window.__PI_MOBILE_TEST__ = { credentialStore: {
    read: () => window.readTestCredential(), write: value => window.saveTestCredential(value), clear: () => window.clearTestCredential(),
  } }; });
  phone = await phoneContext.newPage(); phone.setDefaultTimeout(20_000);
  phone.on("pageerror", error => errors.push({ surface: "phone", message: error.message, after: passed.at(-1) }));
  await phone.goto(vite.resolvedUrls.local[0]);
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator('.login-form button[type="submit"]').click();
  await phone.getByRole("heading", { name: "Shared work", exact: true }).waitFor();
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".grant-open").first().waitFor();
  await openSession(session.id);

  await phone.locator(".attachment-preview").filter({ hasText: "controlled-image.png" }).click();
  await phone.locator('.image-preview-button img[alt="controlled-image.png"]').waitFor();
  const imageLoaded = await phone.locator('.image-preview-button img[alt="controlled-image.png"]').evaluate(img => img.complete && img.naturalWidth > 0);
  const reads = fixture.relayCalls.filter(call => call.method === "attachment/read").length;
  check("online image loads through the real attachment relay and IndexedDB", imageLoaded && reads > 0 && await attachmentCount() === 1);
  await phone.screenshot({ path: join(output, "online-image.png"), fullPage: true });

  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.back());
  await until(async () => !(await view()).selectedId, "session closed before offline reload");
  await phone.route(`${fixture.origin}/**`, route => route.abort("internetdisconnected"));
  fixture.disconnectPhones();
  await phone.reload();
  await phone.locator(".grant-open").first().waitFor();
  await openSession(session.id);
  await phone.locator(".attachment-preview").filter({ hasText: "controlled-image.png" }).click();
  await phone.locator('.image-preview-button img[alt="controlled-image.png"]').waitFor();
  await phone.getByRole("button", { name: "Preview", exact: true }).click();
  await phone.locator('.image-preview[role="dialog"] img').waitFor();
  const offlineImageLoaded = await phone.locator('.image-preview[role="dialog"] img').evaluate(img => img.complete && img.naturalWidth > 0);
  check("offline reload previews the IndexedDB image without another relay read", offlineImageLoaded && fixture.relayCalls.filter(call => call.method === "attachment/read").length === reads);
  await phone.screenshot({ path: join(output, "offline-image.png"), fullPage: true });

  await phone.unroute(`${fixture.origin}/**`);
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.resume());
  await until(async () => (await view()).connection === "connected", "phone reconnected");
  await page.locator('[data-action="revoke-mobile-grant"]').first().click();
  await page.locator('[data-action="confirm-mobile-revoke"]').click();
  await until(async () => fixture.peers.size === 0 && (await view()).grants.length === 0, "grant revoked");
  await until(async () => await attachmentCount() === 0, "attachment cache cleared");
  await phone.reload();
  await until(async () => !(await view()).loading, "revoked phone restarted");
  check("revocation removes image bytes and shared session after reload", await attachmentCount() === 0 && (await view()).directories.length === 0 && await phone.locator(".grant-open").count() === 0);
  check("acceptance made no model calls", fixture.chats.length === 0 && fixture.upstream.calls.length === 0);
} catch (error) {
  errors.push({ message: error.stack ?? error.message, after: passed.at(-1) }); process.exitCode = 1;
  await phone?.screenshot({ path: join(output, "phone-failure.png"), fullPage: true }).catch(() => undefined);
  console.error(error);
} finally {
  if (desktop) await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; }).then(() => desktop.close()).catch(error => cleanupErrors.push(error.message));
  await browser?.close().catch(error => cleanupErrors.push(error.message));
  await vite.close().catch(error => cleanupErrors.push(error.message)); fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ startedRevision, finishedRevision: revision(), passed, errors, cleanupErrors, relayCalls: fixture.relayCalls }, null, 2));
  if (errors.length || cleanupErrors.length) process.exitCode = 1;
  console.log(`Attachment cache acceptance report: ${output}`);
}
