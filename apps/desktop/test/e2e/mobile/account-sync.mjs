import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { HostProcess } from "@pi-desktop/host-runtime";
import { mobileFixture } from "./fixture.mjs";

// Actual Electron/Rust and phone-sized browser acceptance against a controlled
// MC boundary. No model requests, production accounts, or user profiles.
const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mobile-account-${Date.now()}`));
const hostBinary = process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe");
const revision = () => ({
  candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  base: execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(),
  workspace: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim(),
});
const startedRevision = revision();
const passed = [], errors = [], cleanupErrors = [], desktops = [];
const check = (label, value = true) => { assert(value, label); passed.push(label); console.log(`PASS ${label}`); };
const until = async (probe, label, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
await mkdir(output, { recursive: true });
const fixture = await mobileFixture();
process.env.VITE_MC_ORIGIN = fixture.origin;
const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
const vite = await createServer({ root: join(root, "apps/mobile"), mode: "acceptance", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
await vite.listen();
let browser, phone, phoneContext, credentials;
const view = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot());
const invoke = (device, channel, ...args) => device.page.evaluate(async ({ channel, args }) => {
  const reply = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}, { channel, args });
const withHost = async (device, action) => {
  const host = new HostProcess({ binaryPath: hostBinary, dataDir: device.profile, onStderr() {} });
  try { await host.handshake(); return await action(host); } finally { await host.dispose(); }
};
async function seed(name, count) {
  const device = { name, profile: join(output, `profile-${name}`), electronProfile: join(output, `electron-${name}`) };
  desktops.push(device);
  await withHost(device, async (host) => {
    const projectPath = join(output, "same-project-path");
    const emptyPath = join(output, `empty-${name}`);
    await mkdir(projectPath, { recursive: true }); await mkdir(emptyPath, { recursive: true });
    await host.call("project.group.create", { name: "Shared project", folders: [projectPath] });
    await host.call("project.group.create", { name: "Empty project", folders: [emptyPath] });
    device.session = (await host.call("session.create", { title: `${name} history`, projectPath, mode: "agent" })).session;
    device.ungrouped = (await host.call("session.create", { title: `${name} ungrouped`, mode: "agent" })).session;
    for (let index = 0; index < count; index++) await host.call("session.appendMessage", {
      sessionId: device.session.id,
      message: { id: `${name}-${index}`, role: index % 2 ? "assistant" : "user", content: `${name} historical message ${String(index).padStart(3, "0")}`,
        status: "complete", createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() },
    });
    await host.call("settings.set", { language: "en", theme: "dark" });
  });
  return device;
}
async function launch(device, first = false) {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: device.profile, PI_DESKTOP_HOST_BIN: hostBinary, PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  device.app = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), `--user-data-dir=${device.electronProfile}`], env, timeout: 60_000 });
  device.page = await until(async () => {
    for (const page of device.app.windows()) if (await page.locator(".app-shell").count()) return page;
  }, `${device.name} shell`, 60_000);
  device.page.setDefaultTimeout(20_000);
  await device.page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  if (first) {
    await device.app.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__accountSyncAuth = url; }; });
    await device.page.getByRole("dialog").getByRole("button", { name: /Sign in with MirrorCoding|使用 MirrorCoding 登录/ }).click();
    await fetch(await until(() => device.app.evaluate(() => globalThis.__accountSyncAuth), "controlled login"));
    await until(async () => (await invoke(device, "mirrorcoding/getState")).sync === "success", `${device.name} login`);
    await invoke(device, "settings/set", { ...await invoke(device, "settings/get"), language: "en", theme: "dark" });
    await device.page.reload(); await device.page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  }
}
async function close(device) {
  if (!device.app) return;
  await device.app.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await device.app.close(); device.app = undefined;
}
async function settings(device) {
  await device.page.locator('[data-nav="settings"]').click();
  await device.page.getByRole("button", { name: "Account", exact: true }).click();
  await device.page.locator('[data-testid="mobile-sync-settings"]').waitFor();
}
async function enable(device) {
  await settings(device);
  await device.page.getByRole("switch", { name: "Share this computer's projects", exact: true }).click();
  const status = await until(async () => {
    const status = await invoke(device, "mobile-sync/status");
    return status.accountSyncEnabled && status.deviceId && fixture.desktops.has(status.deviceId) ? status : undefined;
  }, `${device.name} opt-in`);
  device.deviceId = status.deviceId;
  fixture.devices.get(status.deviceId).name = device.name;
}
async function screenshot(name, page = phone) {
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  check(`${name} fits viewport`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function openPhone() {
  browser = await chromium.launch({ headless: true });
  phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: "dark" });
  await phoneContext.exposeBinding("readTestCredential", () => credentials ?? null);
  await phoneContext.exposeBinding("saveTestCredential", (_source, value) => { credentials = value; });
  await phoneContext.exposeBinding("clearTestCredential", () => { credentials = undefined; });
  await phoneContext.addInitScript(() => {
    window.__PI_MOBILE_TEST__ = { credentialStore: { read: () => window.readTestCredential(), write: (value) => window.saveTestCredential(value), clear: () => window.clearTestCredential() } };
  });
  phone = await phoneContext.newPage(); phone.setDefaultTimeout(20_000);
  phone.on("pageerror", error => errors.push({ surface: "phone", message: error.message, after: passed.at(-1) }));
  await phone.goto(vite.resolvedUrls.local[0]);
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator('.login-form button[type="submit"]').click();
  await phone.getByRole("heading", { name: "Shared work", exact: true }).waitFor();
}
async function openSession(device) {
  await phone.locator(".grant-open").filter({ hasText: device.name }).click();
  await phone.locator(".session-card").filter({ hasText: `${device.name} history` }).click();
  await until(async () => (await view()).selectedId === device.session.id && !(await view()).loading, "history opened");
}
async function readAllHistory(expectedCount) {
  while ((await view()).messages.length < expectedCount && (await view()).snapshot?.hasMoreHistory) {
    const before = (await view()).messages.length;
    await phone.locator(".transcript").evaluate(element => { element.scrollTop = 0; });
    if (await phone.locator("button.load-older").isVisible()) await phone.locator("button.load-older").click();
    await until(async () => (await view()).messages.length > before || !(await view()).snapshot?.hasMoreHistory, "older page");
  }
  check(`read ${expectedCount} history rows`, (await view()).messages.length === expectedCount);
}
try {
  const first = await seed("Desktop A", 610), second = await seed("Desktop B", 4), third = await seed("Desktop C", 2);
  await launch(first, true); await enable(first);
  await launch(second, true); await enable(second);
  await first.page.getByRole("button", { name: "Pair account", exact: true }).click();
  const code = (await first.page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();
  check("account code has eight digits", /^\d{8}$/.test(code));
  await screenshot("desktop-account-pairing", first.page);
  await openPhone();
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await until(async () => (await view()).directories.length === 2 && (await view()).directories.every(row => row.sessions.length === 2), "two computer directories");
  check("one account pairing discovers two separate computers", fixture.grants.size === 1 && [...fixture.grants.values()][0].desktopDeviceId === undefined);
  const rows = (await view()).directories;
  check("same project path remains isolated per computer", rows[0].desktopDeviceId !== rows[1].desktopDeviceId && rows.every(row => row.projects.some(project => project.label === "Shared project")));
  check("empty projects and ungrouped sessions are included", rows.every(row => row.projects.some(project => project.label === "Empty project") && row.sessions.some(session => !session.projectId)));
  check("directory discovery does not download history", !fixture.relayCalls.some(call => ["session/attach", "session/snapshot", "session/history"].includes(call.method)));
  await screenshot("mobile-two-computers");
  await openSession(first);
  await readAllHistory(610);
  await screenshot("mobile-history-over-500");
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.back());
  await until(async () => !(await view()).selectedId, "history flushed before reopening");
  const historyRequests = fixture.relayCalls.filter(call => call.method === "session/history").length;
  await phone.route(`${fixture.origin}/**`, route => route.abort("internetdisconnected"));
  fixture.disconnectPhones();
  await phone.reload();
  await phone.locator(".grant-open").filter({ hasText: first.name }).waitFor();
  await openSession(first); await readAllHistory(610);
  check("offline app reload preserves all loaded history", (await view()).messages.some(message => message.id === "Desktop A-0") && fixture.relayCalls.filter(call => call.method === "session/history").length === historyRequests);
  await screenshot("mobile-offline-cached-history");
  await close(first);
  await withHost(first, async host => {
    const { session } = await host.call("session.get", { id: first.session.id });
    const messages = session.messages.slice(0, -1);
    messages[300] = { ...messages[300], content: "Edited on the desktop while phone was offline" };
    await host.call("session.replaceMessages", { sessionId: first.session.id, messages });
    await host.call("session.appendMessage", { sessionId: first.session.id, message: { id: "new-after-restart", role: "assistant", content: "Reply after desktop restart", status: "complete", createdAt: new Date().toISOString() } });
  });
  const beforeReconnect = fixture.relayCalls.length;
  await launch(first);
  await phone.unroute(`${fixture.origin}/**`);
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.resume());
  await until(async () => (await view()).messages.some(message => message.id === "new-after-restart"), "durable delta after host restart");
  await readAllHistory(610);
  const reconnected = (await view()).messages;
  check("restart applies edits and deletion without resurrecting old content", !reconnected.some(message => message.id === "Desktop A-609") && reconnected.find(message => message.id === "Desktop A-300")?.content === "Edited on the desktop while phone was offline");
  const transfer = fixture.relayCalls.slice(beforeReconnect).filter(call => call.sessionId === first.session.id);
  check("restart requests changes instead of another snapshot", transfer.some(call => call.method === "session/changes") && !transfer.some(call => call.method === "session/snapshot" || call.method === "session/history" || call.method === "session/attach" && call.includeSnapshot !== false));
  check("only changed rows cross the relay", transfer.filter(call => call.method === "session/changes").reduce((sum, call) => sum + (call.resultCount ?? 0), 0) === 3);
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.disconnect());
  await launch(third, true); await enable(third);
  await until(async () => (await view()).directories.length === 3, "new computer auto-discovered");
  check("third opted-in computer requires no additional pairing", fixture.grants.size === 1);
  await screenshot("mobile-three-computers");
  await second.page.getByRole("switch", { name: "Share this computer's projects", exact: true }).click();
  await until(async () => !(await view()).directories.some(row => row.desktopDeviceId === second.deviceId), "one computer opted out");
  check("opt-out removes only that computer", (await view()).directories.length === 2 && fixture.grants.size === 1);
  await settings(first);
  await first.page.locator('[data-action="revoke-mobile-grant"]').first().click();
  await first.page.locator('[data-action="confirm-mobile-revoke"]').click();
  await until(async () => fixture.peers.size === 0 && (await view()).grants.length === 0 && (await view()).directories.length === 0, "account authorization revoked");
  await phone.reload();
  await until(async () => !(await view()).loading, "revoked restart");
  check("revocation clears cached computers and history visibility", (await view()).directories.length === 0 && (await view()).messages.length === 0);
  check("acceptance made no model calls", fixture.chats.length === 0 && fixture.upstream.calls.length === 0);
  await screenshot("mobile-account-revoked");
} catch (error) {
  errors.push({ message: error.stack ?? error.message, after: passed.at(-1) }); process.exitCode = 1;
  await phone?.screenshot({ path: join(output, "phone-failure.png"), fullPage: true }).catch(() => undefined);
  if (phone) await writeFile(join(output, "phone-visible.txt"), await phone.locator("body").innerText().catch(() => ""));
  console.error(error);
} finally {
  for (const device of desktops) await close(device).catch(error => cleanupErrors.push(error.message));
  await browser?.close().catch(error => cleanupErrors.push(error.message));
  await vite.close().catch(error => cleanupErrors.push(error.message)); fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ startedRevision, finishedRevision: revision(), passed, errors, cleanupErrors, relayCalls: fixture.relayCalls }, null, 2));
  if (errors.length || cleanupErrors.length) process.exitCode = 1;
  console.log(`Account sync acceptance report: ${output}`);
}
