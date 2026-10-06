import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { mobileFixture } from "./fixture.mjs";
import { accountAndroid } from "./account-android.mjs";

// Actual Electron/Rust and phone-sized browser acceptance against a controlled
// MC boundary. No model requests, production accounts, or user profiles.
const require = createRequire(import.meta.url);
const playwright = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const { _electron, chromium } = playwright;
const root = resolve(import.meta.dirname, "../../../../..");
const desktopRoot = resolve(process.env.PI_TEST_DESKTOP_ROOT ?? root);
const { HostProcess } = await import(pathToFileURL(join(desktopRoot, "packages/host-runtime/dist/index.js")).href);
const nativeAndroid = process.env.PI_TEST_ANDROID === "1";
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mobile-account-${Date.now()}`));
const hostBinary = process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe");
const longMessageId = "Desktop A-608";
const longMessageContent = `Previously expanded response. ${"Offline-readable long content. ".repeat(3_000)}END OF COMPLETE CACHED RESPONSE`;
const revision = () => ({
  candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  base: execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(),
  workspace: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim(),
  desktopRoot,
  desktopCandidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: desktopRoot, encoding: "utf8" }).trim(),
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
const fixture = await mobileFixture({ port: nativeAndroid ? Number(process.env.PI_ANDROID_FIXTURE_PORT ?? 38487) : 0, encryptedLogin: nativeAndroid });
process.env.VITE_MC_ORIGIN = fixture.origin;
let vite;
if (!nativeAndroid) {
  const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
  const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
  vite = await createServer({ root: join(root, "apps/mobile"), mode: "acceptance", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
  await vite.listen();
}
const android = nativeAndroid ? accountAndroid({ root, output, fixture, playwright, check, until, errors, passed }) : undefined;
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
      message: { id: `${name}-${index}`, role: `${name}-${index}` === longMessageId || index % 2 ? "assistant" : "user", content: `${name}-${index}` === longMessageId ? longMessageContent : `${name} historical message ${String(index).padStart(3, "0")}`,
        status: "complete", createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() },
    });
    await host.call("settings.set", { language: "en", theme: "dark" });
  });
  return device;
}
async function launch(device, first = false) {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: device.profile, PI_DESKTOP_HOST_BIN: hostBinary, PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  device.app = await _electron.launch({ executablePath: require("electron"), args: [join(desktopRoot, "apps/desktop"), `--user-data-dir=${device.electronProfile}`], env, timeout: 60_000 });
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
  if (await device.page.locator('[data-testid="mobile-sync-settings"]').isVisible()) return;
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
async function verifySharingRetry(device) {
  fixture.control.sharingUnavailable = true;
  // Enter through public IPC without an extra renderer refresh masking the
  // service's own retry responsibility.
  await invoke(device, "mobile-sync/setAccountSharing", false);
  await until(async () => (await invoke(device, "mobile-sync/status")).error === "RELAY_UNAVAILABLE", "sharing publication failure");
  check("failed sharing keeps local choice and server state distinct",
    !(await invoke(device, "mobile-sync/status")).accountSyncEnabled && fixture.devices.get(device.deviceId).accountSyncEnabled);
  check("desktop exposes pending publication until the server acknowledges it",
    (await invoke(device, "mobile-sync/status")).accountSharingPending === true &&
    (await device.page.locator('[data-testid="mobile-sync-settings"]').innerText()).includes("awaiting server confirmation"));
  await device.page.locator('[data-testid="mobile-sync-settings"] .mobile-sync-status').scrollIntoViewIfNeeded();
  await screenshot("desktop-sharing-pending", device.page);
  fixture.control.sharingUnavailable = false;
  await until(() => fixture.devices.get(device.deviceId).accountSyncEnabled === false, "sharing publication retries without user refresh", 15_000);
  await until(async () => !(await invoke(device, "mobile-sync/status")).accountSharingPending, "sharing pending status clears");
  check("sharing publication recovers automatically while relay remains online");
  await enable(device);
}
async function screenshot(name, page = phone) {
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (android && page === phone) await android.screenshot(name);
  else await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: "disabled" });
  check(`${name} fits viewport`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function openPhone() {
  if (android) phone = await android.open();
  else {
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
  }
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator('.login-form button[type="submit"]').click();
  await phone.getByRole("heading", { name: "Shared work", exact: true }).waitFor();
}
async function appearance(language, theme) {
  await phone.getByRole("button", { name: /^(Account and appearance|账号与外观)$/ }).click();
  await phone.getByLabel(/^(Language|语言)$/).selectOption("en");
  await phone.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: theme, exact: true }).click();
  await phone.getByLabel("Language", { exact: true }).selectOption(language);
  await phone.getByRole("dialog").getByRole("button", { name: /^(Close|关闭)$/ }).click();
  await phone.locator(".surface").waitFor({ state: "hidden" });
}
async function offline(enabled) {
  if (android) await android.offline(enabled);
  else if (enabled) { await phone.route(`${fixture.origin}/**`, route => route.abort("internetdisconnected")); fixture.disconnectPhones(); }
  else await phone.unroute(`${fixture.origin}/**`);
}
async function restartPhone() {
  if (android) phone = await android.restart();
  else await phone.reload();
}
async function openSession(device) {
  await phone.locator(".grant-open").filter({ hasText: device.name }).click();
  await until(async () => (await view()).desktopId === device.deviceId, "computer opened");
  if ((await view()).grant?.scope.kind !== "session") await phone.locator(".session-card").filter({ hasText: `${device.name} history` }).click();
  await until(async () => (await view()).selectedId === device.session.id && !(await view()).loading, "history opened");
}
async function backHome() {
  if ((await view()).selectedId) {
    await phone.getByRole("button", { name: "Back", exact: true }).click();
    await until(async () => !(await view()).selectedId, "back to session list");
  }
  if ((await view()).grant) {
    await phone.getByRole("button", { name: "Back", exact: true }).click();
    await until(async () => !(await view()).grant, "back to computers");
  }
}
async function pairPhone(code) {
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
}
async function pairingError(code, message, screenshotName) {
  const before = (await view()).grants.length;
  await phone.getByRole("button", { name: /^(Pair desktop|配对电脑)$/ }).click();
  const dialog = phone.getByRole("dialog");
  await dialog.locator("input").fill(code);
  await dialog.locator('button[type="submit"]').click();
  await until(async () => (await dialog.getByRole("alert").textContent().catch(() => ""))?.includes(message), "actionable pairing error");
  check("pairing refusal retains the entered code, login and existing grants",
    await dialog.locator("input").inputValue() === code && (await view()).signedIn && (await view()).grants.length === before);
  await screenshot(screenshotName);
  await dialog.getByRole("button", { name: /^(Close|关闭)$/ }).click();
  await dialog.waitFor({ state: "detached" });
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.clearError());
}
async function revokeGrant(device, grantId) {
  const row = device.page.locator(`[data-grant-id="${grantId}"]`);
  await row.locator('[data-action="revoke-mobile-grant"]').click();
  await row.locator('[data-action="confirm-mobile-revoke"]').click();
}
/** Delay one real relay reply while the browser continues accepting input. */
function holdNextChangesReply(device) {
  const entry = [...fixture.peers].find(([, peer]) => peer.desktopDeviceId === device.deviceId);
  assert(entry, "selected desktop has a live mobile peer");
  const [peerId, peer] = entry;
  const send = peer.socket.send;
  let held;
  peer.socket.send = function (data, ...args) {
    const frame = JSON.parse(data.toString());
    const call = fixture.relayCalls.findLast((call) => call.peerId === peerId && call.id === frame.id);
    if (!held && call?.method === "session/changes" && call.sessionId === device.session.id) {
      held = { data, args };
      return;
    }
    return send.call(this, data, ...args);
  };
  return {
    waiting: () => Boolean(held),
    release() {
      peer.socket.send = send;
      if (held) send.call(peer.socket, held.data, ...held.args);
    },
  };
}
async function readWhileChangesPending(device) {
  const before = (await view()).messages.length;
  const gate = holdNextChangesReply(device);
  try {
    // Resuming connectivity is a real application entry point for reconciliation.
    await phone.evaluate(() => window.dispatchEvent(new Event("online")));
    await until(gate.waiting, "controlled delayed changes reply");
    await phone.locator(`[data-message-id="${longMessageId}"] button.load-full`).click();
    await phone.locator(`[data-message-id="${longMessageId}"] button.load-full:disabled`).waitFor();
    await phone.locator(".transcript").evaluate(element => { element.scrollTop = 0; });
    await phone.locator('.load-older[role="status"]').waitFor();
    await screenshot("mobile-reading-during-delayed-sync");
  } finally { gate.release(); }
  await until(async () => {
    const state = await view();
    return state.messages.length > before && state.messages.find(message => message.id === longMessageId)?.content === longMessageContent;
  }, "older page and expanded content survive concurrent changes");
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  const state = await view();
  check("paging and full-content loading survive a delayed changes reply", state.messages.length > before && state.messages.find(message => message.id === longMessageId)?.content === longMessageContent);
}
async function readAllHistory(expectedCount) {
  while ((await view()).messages.length < expectedCount && (await view()).snapshot?.hasMoreHistory) {
    const before = (await view()).messages.length;
    await phone.locator(".transcript").evaluate(element => { element.scrollTop = 0; });
    await until(async () => (await view()).messages.length > before || !(await view()).snapshot?.hasMoreHistory, "older page");
    await phone.locator('.load-older[role="status"]').waitFor({ state: "detached" });
  }
  check(`read ${expectedCount} history rows`, (await view()).messages.length === expectedCount);
}
try {
  await android?.prepare();
  const first = await seed("Desktop A", 610), second = await seed("Desktop B", 4), third = await seed("Desktop C", 2);
  await launch(first, true); await enable(first);
  await verifySharingRetry(first);
  await launch(second, true); await enable(second);
  await first.page.getByRole("button", { name: "Pair account", exact: true }).click();
  const code = (await first.page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();
  check("account code has eight digits", /^\d{8}$/.test(code));
  await screenshot("desktop-account-pairing", first.page);
  await openPhone();
  await pairPhone(code);
  await until(async () => (await view()).directories.length === 2 && (await view()).directories.every(row => row.sessions.length === 2), "two computer directories");
  check("one account pairing discovers two separate computers", fixture.grants.size === 1 && [...fixture.grants.values()][0].desktopDeviceId === undefined);
  const rows = (await view()).directories;
  check("same project path remains isolated per computer", rows[0].desktopDeviceId !== rows[1].desktopDeviceId && rows.every(row => row.projects.some(project => project.label === "Shared project")));
  check("empty projects and ungrouped sessions are included", rows.every(row => row.projects.some(project => project.label === "Empty project") && row.sessions.some(session => !session.projectId)));
  check("directory discovery does not download history", !fixture.relayCalls.some(call => ["session/attach", "session/snapshot", "session/history"].includes(call.method)));
  await pairingError(code, "already used", "mobile-used-pairing-code");
  const expired = await invoke(first, "mobile-sync/createPairing", { kind: "session", sessionId: first.session.id });
  fixture.pairings.get(expired.id).pairing.expiresAt = "2020-01-01T00:00:00Z";
  await appearance("zh-CN", "Light");
  await pairingError(expired.code, "配对码已过期", "mobile-expired-pairing-light-zh");
  await appearance("en", "Dark");
  await screenshot("mobile-two-computers");
  await openSession(second); await readAllHistory(4);
  await close(second);
  await until(async () => (await view()).directories.find(row => row.desktopDeviceId === second.deviceId)?.device.online === false, "sleeping computer remains discoverable");
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.clearError());
  const ticketCount = fixture.calls.filter(call => call.path === "/api/pi-sync/relay/ticket").length;
  for (let i = 0; i < 3; i++) await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshGrants());
  await backHome();
  await openSession(second);
  check("offline computer keeps cached history without repeated ticket requests or alerts",
    (await view()).messages.length === 4 && !(await view()).error &&
    fixture.calls.filter(call => call.path === "/api/pi-sync/relay/ticket").length === ticketCount);
  await screenshot("mobile-computer-offline-history");
  await launch(second);
  await until(async () => { const state = await view(); return state.connection === "connected" && !state.loading && state.snapshot?.session.id === second.session.id; }, "computer reconnects after waking");
  await backHome();
  await openSession(first);
  await readWhileChangesPending(first);
  await readAllHistory(610);
  await screenshot("mobile-history-over-500");
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.back());
  await until(async () => !(await view()).selectedId, "history flushed before reopening");
  const historyRequests = fixture.relayCalls.filter(call => call.method === "session/history").length;
  await offline(true);
  await restartPhone();
  await phone.locator(".grant-open").filter({ hasText: first.name }).waitFor();
  await openSession(first); await readAllHistory(610);
  check("offline app reload preserves all loaded history", (await view()).messages.some(message => message.id === "Desktop A-0") && fixture.relayCalls.filter(call => call.method === "session/history").length === historyRequests);
  check("previously expanded long content stays complete after offline reload", (await view()).messages.find(message => message.id === longMessageId)?.content === longMessageContent &&
    await phone.locator(`[data-message-id="${longMessageId}"] button.load-full`).count() === 0);
  await screenshot("mobile-offline-cached-history");
  if (android) {
    await appearance("zh-CN", "Light");
    await screenshot("android-offline-history-light-zh");
    await appearance("en", "Dark");
  }
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
  await offline(false);
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
  await settings(second);
  await second.page.getByRole("switch", { name: "Share this computer's projects", exact: true }).click();
  await until(async () => !(await view()).directories.some(row => row.desktopDeviceId === second.deviceId), "one computer opted out");
  check("opt-out removes only that computer", (await view()).directories.length === 2 && fixture.grants.size === 1);

  const accountGrant = [...fixture.grants.values()].find(grant => grant.scope.kind === "account");
  const sessionPairing = await invoke(first, "mobile-sync/createPairing", { kind: "session", sessionId: first.session.id });
  await pairPhone(sessionPairing.code);
  await until(async () => (await view()).grants.length === 2, "additional session authorization");
  const sessionGrant = [...fixture.grants.values()].find(grant => grant.scope.kind === "session");
  check("session pairing preserves the separate account grant", Boolean(accountGrant && sessionGrant?.scope.id === first.session.id));
  const broadDirectory = await phone.evaluate(async ({ accountId, desktopDeviceId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("pi.mobile.transcripts", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("directories").objectStore("directories").get(JSON.stringify([accountId, desktopDeviceId]));
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, { accountId: accountGrant.accountId, desktopDeviceId: first.deviceId });
  check("account directory cached both previously authorized sessions", broadDirectory.sessions.length === 2);
  await openSession(third); await readAllHistory(2);
  await settings(first);
  const oldPeer = [...fixture.peers].find(([, peer]) => peer.desktopDeviceId === first.deviceId)?.[0];
  await revokeGrant(first, accountGrant.id);
  await until(async () => {
    const state = await view();
    return state.grants.length === 1 && state.directories.length === 1 &&
      state.directories[0].desktopDeviceId === first.deviceId && state.directories[0].sessions.length === 1 &&
      state.directories[0].sessions[0].id === first.session.id && !state.selectedId && !state.messages.length;
  }, "account revocation narrows access to the remaining session");
  check("account revocation closes removed content and retains the independent session grant");
  await until(() => [...fixture.peers].some(([id, peer]) => id !== oldPeer && peer.desktopDeviceId === first.deviceId &&
    peer.grants.length === 1 && peer.grants[0].id === sessionGrant.id), "remaining scope reconnects with a fresh ticket");
  check("MC permission narrowing closes the old peer and reconnects with the remaining session grant",
    fixture.closedPeers.some(peer => peer.peerId === oldPeer && peer.reason === "GRANT_REVOKED"));
  const scopedHistoryRequests = fixture.relayCalls.filter(call => call.method === "session/history").length;
  await offline(true);
  // Emulate a process stopping after new grants were saved but before the old
  // directory write was replaced. Keep the authoritative saved grants intact.
  await phone.evaluate(async directory => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("pi.mobile.transcripts", 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("directories", "readwrite");
        transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error);
        transaction.objectStore("directories").put(directory);
      });
    } finally { db.close(); }
  }, broadDirectory);
  await restartPhone();
  await phone.locator(".grant-open").filter({ hasText: first.name }).waitFor();
  const scopedOffline = await view();
  check("offline restart exposes only the still-authorized session", scopedOffline.grants.length === 1 && scopedOffline.grants[0].id === sessionGrant.id &&
    scopedOffline.directories.length === 1 && scopedOffline.directories[0].sessions.length === 1 && scopedOffline.directories[0].sessions[0].id === first.session.id);
  check("interrupted directory pruning cannot widen saved session authorization", !scopedOffline.directories[0].sessions.some(session => session.id === first.ungrouped.id));
  await openSession(first); await readAllHistory(610);
  check("remaining session keeps its cached history after account revocation", (await view()).messages.some(message => message.id === "Desktop A-0") &&
    !(await view()).messages.some(message => message.id.startsWith("Desktop C-")) && fixture.relayCalls.filter(call => call.method === "session/history").length === scopedHistoryRequests);
  await screenshot("mobile-offline-session-grant");
  await offline(false);
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.resume());
  await until(async () => (await view()).connection === "connected", "remaining session reconnected");
  await revokeGrant(first, sessionGrant.id);
  await until(async () => fixture.peers.size === 0 && (await view()).grants.length === 0 && (await view()).directories.length === 0, "account authorization revoked");
  await restartPhone();
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
  await android?.close().catch(error => cleanupErrors.push(error.message));
  await vite?.close().catch(error => cleanupErrors.push(error.message)); fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ startedRevision, finishedRevision: revision(), ...android?.report, passed, errors, cleanupErrors, relayCalls: fixture.relayCalls }, null, 2));
  if (errors.length || cleanupErrors.length) process.exitCode = 1;
  console.log(`Account sync acceptance report: ${output}`);
}
