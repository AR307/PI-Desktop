import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { HostProcess } from "@pi-desktop/host-runtime";
import { mobileFixture } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
const { createServer } = await import(pathToFileURL(mobileRequire.resolve("vite")).href);
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mobile-${Date.now()}`));
const revision = () => ({
  candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  base: execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(),
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
let desktop, page, browser, phone, phoneContext, closing = false, savedCredentials;
const check = (label, result = true) => { assert(result, label); passed.push(label); console.log(`PASS ${label}`); };
const until = async (probe, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
const view = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot());
async function openDesktop() {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "profile"), PI_DESKTOP_HOST_BIN: process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe"), PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`], env, timeout: 60_000 });
  page = await until(async () => { for (const candidate of desktop.windows()) if (await candidate.locator(".app-shell").count()) return candidate; }, "desktop shell", 60_000);
  page.setDefaultTimeout(20_000); page.on("pageerror", (error) => { if (!closing) errors.push({ surface: "desktop", message: error.message, after: passed.at(-1) }); });
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__authUrl = url; }; });
}
async function closeDesktop() {
  if (!desktop) return;
  closing = true; await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await desktop.close(); desktop = undefined; closing = false;
}
async function openPhone() {
  browser = await chromium.launch({ headless: true });
  phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: "dark" });
  await phoneContext.exposeBinding("testCredentialRead", () => savedCredentials ?? null);
  await phoneContext.exposeBinding("testCredentialWrite", (_source, value) => { savedCredentials = value; });
  await phoneContext.exposeBinding("testCredentialClear", () => { savedCredentials = undefined; });
  await phoneContext.addInitScript(() => {
    window.__PI_MOBILE_TEST__ = { credentialStore: { read: () => window.testCredentialRead(), write: (value) => window.testCredentialWrite(value), clear: () => window.testCredentialClear() } };
  });
  phone = await phoneContext.newPage(); phone.setDefaultTimeout(20_000);
  phone.on("pageerror", (error) => errors.push({ surface: "mobile", message: error.message, after: passed.at(-1) }));
  await phone.goto(mobileOrigin);
}
async function loginPhone(username = "mobileqa") {
  await phone.locator('[name="username"]').fill(username);
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("heading", { name: "Shared work", exact: true }).waitFor();
}
async function pairPhone(code) {
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
}
async function shareSession(sessionId) {
  await page.locator(`[data-sidebar-session-row="${sessionId}"]`).first().click({ button: "right" });
  await page.locator('[data-action="sync-session-mobile"]').click();
  await page.locator('[data-testid="mobile-pairing-code"]').waitFor();
  return (await page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();
}
async function mobileSend(text) {
  await phone.locator(".composer textarea").fill(text);
  await phone.getByRole("button", { name: "Send", exact: true }).click();
}
async function screenshot(name, surface = phone) {
  await surface.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return timing && Number.isFinite(timing.endTime);
    });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
  await surface.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  check(`${name}: fits viewport`, await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function seedHistory() {
  const host = new HostProcess({ binaryPath: process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe"), dataDir: join(output, "profile"), onStderr() {} });
  try {
    await host.handshake();
    const projectPath = join(output, "planning-workspace");
    await mkdir(projectPath, { recursive: true });
    const { session } = await host.call("session.create", { title: "Mobile shared session", projectPath, mode: "agent" });
    for (let index = 0; index < 60; index++) await host.call("session.appendMessage", {
      sessionId: session.id, message: { id: randomUUID(), role: index % 2 ? "assistant" : "user", content: `Historical message ${String(index).padStart(2, "0")}`, status: "complete", createdAt: new Date(Date.now() - (60 - index) * 1000).toISOString() },
    });
    return session;
  } finally { await host.dispose(); }
}
try {
  const shared = await seedHistory();
  await openDesktop();
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  await fetch(await until(() => desktop.evaluate(() => globalThis.__authUrl), "desktop browser authorization"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "MC catalog login");
  const providers = (await invoke("providers/list")).providers;
  const provider = providers.find((item) => item.mirrorCoding?.groupId === "中文 分组");
  const autoProvider = providers.find((item) => item.mirrorCoding?.groupId === "auto");
  await invoke("settings/set", { ...await invoke("settings/get"), defaultProviderId: provider.id, defaultModelId: "gpt-5", language: "en", theme: "dark" });
  await invoke("session/configure", shared.id, { providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "agent" });
  const hidden = (await invoke("session/create", { title: "Private desktop session", providerId: provider.id, modelId: "gpt-5", mode: "agent" })).session;
  await invoke("project/set", shared.projectPath);
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(`[data-sidebar-session-row="${shared.id}"] .thread-item-main`).first().click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("History created on the desktop before pairing"); await editor.press("Enter");
  await until(async () => (await invoke("session/get", { id: shared.id })).session.messages.some((message) => message.role === "assistant"), "desktop history");
  let code = await shareSession(shared.id);
  check("desktop context menu creates eight-digit code", /^\d{8}$/.test(code));
  const box = await page.getByRole("dialog").boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  check("pairing dialog is centered", Math.abs(box.x + box.width / 2 - viewport.width / 2) < 3 && Math.abs(box.y + box.height / 2 - viewport.height / 2) < 3);
  await screenshot("desktop-pairing-dark-en", page);
  const previousCode = code;
  await page.locator('[data-action="regenerate-mobile-pairing"]').click();
  await until(async () => (await page.locator('[data-testid="mobile-pairing-code"]').textContent().catch(() => ""))?.trim() !== previousCode && await page.locator('[data-testid="mobile-pairing-code"]').count(), "new pairing code");
  code = (await page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();
  check("regenerating replaces and cancels previous pairing", ![...fixture.pairings.values()].some((item) => item.pairing.code === previousCode));
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
  check("Escape closes pairing dialog and cancels pending code", ![...fixture.pairings.values()].some((item) => item.pairing.code === code));
  code = await shareSession(shared.id);
  await openPhone(); await screenshot("mobile-login-dark-en"); await loginPhone("other"); await pairPhone(code);
  await until(async () => (await view()).error, "wrong-account rejection");
  check("wrong account cannot consume owner's pairing", fixture.grants.size === 0);
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.logout());
  await loginPhone(); await pairPhone("99999999");
  await until(async () => (await view()).error === "PAIRING_INVALID", "invalid pairing code rejected");
  check("unknown pairing code does not expose shared work", fixture.grants.size === 0);
  [...fixture.pairings.values()].find((item) => item.pairing.code === code).pairing.expiresAt = new Date(Date.now() - 1000).toISOString();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await until(async () => (await view()).error === "PAIRING_EXPIRED", "expired pairing code rejected");
  check("expired pairing code cannot create a share", fixture.grants.size === 0);
  const expiredCode = code;
  await page.locator('[data-action="regenerate-mobile-pairing"]').click();
  code = await until(async () => {
    const value = (await page.locator('[data-testid="mobile-pairing-code"]').textContent().catch(() => ""))?.trim();
    return value && value !== expiredCode ? value : undefined;
  }, "replacement after expired pairing");
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".grant-open").filter({ hasText: "Mobile shared session" }).waitFor();
  await page.getByText("Device paired. Your phone can now view and continue this work.", { exact: true }).waitFor();
  await page.locator('[data-action="close-mobile-pairing"]').click();
  check("same account pairs through both visible interfaces");
  fixture.expireMobileAccess();
  await phone.getByRole("button", { name: "Refresh", exact: true }).click();
  await until(() => fixture.control.mobileRefreshes === 1, "mobile expired access renewed");
  await until(async () => !(await view()).busy, "renewed work list loaded");
  check("concurrent work-list requests refresh mobile access once", !(await view()).error && (await view()).grants.length === 1);
  await phone.locator(".grant-open").filter({ hasText: "Mobile shared session" }).click();
  await phone.getByText("History created on the desktop before pairing", { exact: true }).waitFor();
  check("phone loads existing desktop history", (await view()).sessions.length === 1);
  check("conversation header identifies the shared session and online desktop", await phone.locator(".app-heading strong").textContent() === "Mobile shared session" && (await phone.locator(".app-heading small").textContent()).includes("Online"));
  check("phone initially bounds a long conversation", (await view()).snapshot.hasMoreHistory === true && !(await view()).messages.some((message) => message.content === "Historical message 00"));
  await editor.fill("Desktop event during mobile history paging"); await editor.press("Enter");
  await phone.getByRole("button", { name: "Load earlier messages", exact: true }).click();
  await phone.getByText("Historical message 00", { exact: true }).waitFor();
  await phone.getByText("Desktop event during mobile history paging", { exact: true }).waitFor();
  check("older history and live desktop output merge without duplicates", new Set((await view()).messages.map((message) => message.id)).size === (await view()).messages.length);
  await until(async () => !(await view()).snapshot?.activeTurn, "desktop paging turn finished");
  const forbidden = await phone.evaluate(async (sessionId) => {
    try { await window.__PI_MOBILE_CONTROLLER__.relay.request("session/attach", { sessionId }); return false; }
    catch (error) { return /not.shared|FORBIDDEN|forbidden/i.test(error.message); }
  }, hidden.id);
  check("single-session share rejects unshared history", forbidden);
  await mobileSend("Message continued from the phone");
  await until(async () => (await invoke("session/get", { id: shared.id })).session.messages.some((message) => message.role === "user" && message.content === "Message continued from the phone"), "phone message persisted");
  await page.getByText("Message continued from the phone", { exact: true }).waitFor();
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "phone turn completed");
  check("phone continuation reaches desktop and retains reasoning", fixture.chats.some((body) => body.reasoning_effort === "medium"));
  await screenshot("mobile-conversation-dark-en");
  await phone.getByRole("button", { name: "Account and appearance", exact: true }).click();
  await phone.getByRole("heading", { name: "Account", exact: true }).waitFor();
  await screenshot("mobile-account-sheet-dark-en");
  await phone.keyboard.press("Escape"); await phone.getByRole("heading", { name: "Account", exact: true }).waitFor({ state: "hidden" });
  await mobileSend("mobile-slow streaming task");
  await phone.getByText("Working on the computer.", { exact: false }).waitFor();
  await phone.locator(".conversation-controls .model-chip").click();
  await phone.locator(".model-row").filter({ hasText: "gpt-5" }).first().click();
  await phone.locator(".model-variant").filter({ hasText: "auto" }).click();
  await phone.getByLabel("Thinking level", { exact: true }).selectOption("high");
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await phone.locator(".surface").waitFor({ state: "hidden" });
  await until(async () => {
    const configuration = (await view()).snapshot?.session.configuration;
    return configuration?.current?.providerId === provider.id && configuration.current.thinkingLevel === "medium" && configuration.next.providerId === autoProvider.id && configuration.next.thinkingLevel === "high";
  }, "running task keeps current configuration while mobile saves the next selection");
  check("running task keeps its model while mobile preselects the next model and reasoning level");
  await mobileSend("Queued from the phone while running");
  await until(async () => (await view()).snapshot?.queuedTurns.length === 1, "shared queue");
  check("phone sees live output and queues messages on desktop");
  fixture.releaseChats();
  await until(async () => (await invoke("session/get", { id: shared.id })).session.messages.some((message) => message.content === "Queued from the phone while running"), "queued user message executed");
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn && !(await view()).snapshot?.queuedTurns.length, "queue drained");
  check("queued turn uses the newly saved group and reasoning level", fixture.chatRequests.some((request) => request.prompt.includes("Queued from the phone while running") && request.group === "auto") && fixture.chats.some((body) => body.reasoning_effort === "high" && JSON.stringify(body.messages.at(-1)).includes("Queued from the phone while running")));
  await invoke("session/configure", shared.id, { providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "agent" });
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  await mobileSend("mobile-slow stopped task"); await phone.getByRole("button", { name: "Stop", exact: true }).waitFor();
  await phone.getByRole("button", { name: "Stop", exact: true }).click();
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "phone stop");
  check("phone stop interrupts active desktop turn", fixture.control.abortedChats > 0);
  await mobileSend("mobile-question choose a color");
  await phone.getByRole("radio", { name: "Blue", exact: true }).check();
  await phone.getByRole("button", { name: "Submit answer", exact: true }).click();
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "question answered");
  check("phone answers agent question and execution continues", fixture.chats.some((body) => body.messages.some((message) => message.role === "tool" && String(message.content).includes("Blue"))));
  await mobileSend("mobile-approval run a harmless command");
  await phone.getByRole("button", { name: "Allow once", exact: true }).click();
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "permission approved");
  check("phone approves a desktop tool request", fixture.chats.some((body) => body.messages.some((message) => message.role === "tool" && String(message.content).includes("mobile-approved"))));
  await invoke("session/configure", shared.id, { providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "plan" });
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  await mobileSend("mobile-plan prepare a small implementation plan");
  await phone.getByRole("button", { name: "Approve plan", exact: true }).waitFor();
  await phone.getByText("Mobile acceptance plan", { exact: true }).first().waitFor();
  await screenshot("mobile-plan-approval-dark-en");
  const planPeerIds = new Set(fixture.peers.keys());
  fixture.disconnectPhones();
  await until(async () => [...fixture.peers.keys()].some((peerId) => !planPeerIds.has(peerId)) && (await view()).connection === "connected" && (await view()).snapshot?.pendingApprovals.some((request) => request.kind === "plan"), "pending plan restored after phone reconnect");
  check("phone reconnect restores the actionable desktop plan");
  await phone.getByRole("button", { name: "Approve plan", exact: true }).click();
  await until(async () => !(await view()).busy && !(await view()).snapshot?.pendingApprovals.length && !(await view()).snapshot?.activeTurn, "mobile plan approved");
  check("phone reads and approves a plan for desktop execution");
  await invoke("session/configure", shared.id, { providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "agent" });
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  const chooser = phone.waitForEvent("filechooser"); await phone.getByRole("button", { name: "Attach photos or files", exact: true }).click();
  await (await chooser).setFiles({ name: "mobile-reference.png", mimeType: "image/png", buffer: fixture.upstream.bytes });
  await phone.getByText("mobile-reference.png", { exact: true }).waitFor();
  await mobileSend("Describe this phone attachment");
  await until(async () => (await invoke("session/get", { id: shared.id })).session.messages.some((message) => message.content === "Describe this phone attachment" && message.attachments?.length === 1), "phone attachment persisted");
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "attachment turn complete");
  check("phone photo uploads to desktop attachment storage");
  fixture.control.dropTurnReplyOnce = true;
  await mobileSend("A single message with an unconfirmed response");
  await until(async () => {
    const value = await view();
    return value.connection === "connected" && !value.busy && !value.uncertainMessageId && value.messages.some((message) => message.content === "A single message with an unconfirmed response");
  }, "unconfirmed send reconciled after reconnect");
  const uncertainMessages = (await invoke("session/get", { id: shared.id })).session.messages.filter((message) => message.role === "user" && message.content === "A single message with an unconfirmed response");
  check("lost send acknowledgement reconnects without duplicating generation", uncertainMessages.length === 1 && fixture.chats.filter((body) => body.tools?.length && JSON.stringify(body.messages.filter((message) => message.role === "user").at(-1)).includes("A single message with an unconfirmed response")).length === 1);
  await phone.locator(".composer textarea").fill("Draft preserved across reconnect");
  const draftPeerIds = new Set(fixture.peers.keys());
  fixture.disconnectPhones();
  await until(async () => [...fixture.peers.keys()].some((peerId) => !draftPeerIds.has(peerId)) && (await view()).connection === "connected" && Boolean((await view()).snapshot), "phone reconnect");
  check("reconnect keeps draft and restores history", await phone.locator(".composer textarea").inputValue() === "Draft preserved across reconnect");
  await invoke("image/configure", { key: shared.id, config: { active: true, providerId: provider.id, modelId: "text-only-image-fixture", options: { count: 1 } } });
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  await phone.getByLabel("Describe an image…").waitFor();
  await phone.getByRole("button", { name: "Use as reference", exact: true }).first().click();
  await phone.locator(".composer-attachments").getByText("mobile-reference.png", { exact: true }).waitFor();
  const beforeInvalidImage = fixture.upstream.calls.length;
  await mobileSend("Keep this prompt when references are unsupported");
  await until(async () => !(await view()).busy && Boolean((await view()).error), "unsupported image reference rejected");
  check("invalid image request retains prompt and reference without generation", await phone.locator(".composer textarea").inputValue() === "Keep this prompt when references are unsupported" && await phone.locator(".composer-attachments").getByText("mobile-reference.png", { exact: true }).count() === 1 && fixture.upstream.calls.length === beforeInvalidImage);
  await invoke("image/configure", { key: shared.id, config: { active: true, providerId: provider.id, modelId: "gpt-image-1", options: { count: 1, size: "1024x1024" } } });
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.refreshSession());
  await mobileSend("A gradient landscape from the phone");
  await until(() => fixture.upstream.calls.length > 0, "mobile image request");
  await phone.locator(".image-result .attachment-preview").first().click();
  await phone.locator(".image-result img").first().waitFor();
  check("phone image mode uses desktop model, group and reference endpoint", fixture.upstream.calls.at(-1).body.model === "gpt-image-1" && fixture.upstream.calls.at(-1).group === encodeURIComponent("中文 分组") && fixture.upstream.calls.at(-1).path === "/v1/images/edits" && fixture.upstream.calls.at(-1).body.images.length === 1);
  const mobileCatalog = await view();
  check("phone receives separate chat and image model catalogs", mobileCatalog.catalog?.chat.some((choice) => choice.modelId === "gpt-5") === true && mobileCatalog.catalog?.image.some((choice) => choice.modelId === "gpt-image-1") === true);
  await phone.locator(".conversation-controls .model-chip").click();
  await phone.locator(".model-row").filter({ hasText: "gpt-image-1" }).first().click();
  await phone.locator(".model-variant").filter({ hasText: "中文 分组" }).click();
  await phone.getByLabel("Size", { exact: true }).selectOption("1536x1024");
  await phone.getByLabel("Quality", { exact: true }).selectOption("high");
  await phone.getByLabel("Count", { exact: true }).selectOption("2");
  await phone.locator(".model-row").filter({ hasText: "text-only-image-fixture" }).click();
  check("changing image models clears unsupported parameters and clamps count", await phone.getByLabel("Count", { exact: true }).inputValue() === "1" && await phone.getByText("Unsupported parameters were reset for this model.", { exact: true }).count() === 1 && await phone.getByLabel("Size", { exact: true }).count() === 0 && await phone.getByLabel("Quality", { exact: true }).count() === 0);
  await phone.locator(".model-row").filter({ hasText: "gpt-image-1" }).first().click();
  await phone.locator(".model-variant").filter({ hasText: "中文 分组" }).click();
  await phone.getByLabel("Size", { exact: true }).selectOption("1536x1024");
  await phone.getByLabel("Quality", { exact: true }).selectOption("high");
  await phone.getByLabel("Count", { exact: true }).selectOption("2");
  await screenshot("mobile-image-settings-dark-en");
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await until(async () => (await view()).snapshot?.session.imageConfig?.options.size === "1536x1024" && (await view()).snapshot?.session.imageConfig?.options.count === 2, "mobile saves image parameters");
  check("mobile saves only declared image parameters for the shared session");
  await phone.locator(".surface").waitFor({ state: "hidden" });
  await phone.locator(".conversation-controls .config-chip").first().click();
  await phone.getByRole("heading", { name: "Choose mode", exact: true }).waitFor();
  await screenshot("mobile-mode-sheet-dark-en");
  await phone.locator(".mode-option").filter({ hasText: "Agent" }).click();
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await until(async () => (await view()).snapshot?.session.taskMode === "agent", "mobile returns from image mode to chat");
  check("mobile keeps chat selection when leaving image mode", (await view()).snapshot.session.modelId === "gpt-5" && (await view()).snapshot.session.imageConfig?.active === false);
  await phone.locator(".surface").waitFor({ state: "hidden" });
  for (const [label, mode] of [["Plan", "plan"], ["Goal", "goal"], ["Agent", "agent"]]) {
    await phone.locator(".conversation-controls .config-chip").first().click();
    await phone.locator(".mode-option").filter({ hasText: label }).click();
    await phone.getByRole("button", { name: "Apply", exact: true }).click();
    await until(async () => (await view()).snapshot?.session.taskMode === mode, `mobile applies ${mode} mode`);
    await phone.locator(".surface").waitFor({ state: "hidden" });
  }
  check("mobile applies Agent, Plan and Goal modes to the shared session");
  await phone.locator(".conversation-controls .model-chip").click();
  await phone.locator(".model-row").filter({ hasText: "gpt-5" }).first().click();
  await phone.locator(".model-variant").filter({ hasText: "中文 分组" }).click();
  await phone.getByLabel("Thinking level", { exact: true }).selectOption("high");
  await screenshot("mobile-model-groups-dark-en");
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await until(async () => (await view()).snapshot?.session.thinkingLevel === "high", "mobile saves reasoning level");
  check("mobile saves the selected MirrorCoding group and reasoning level");
  await phone.locator(".surface").waitFor({ state: "hidden" });
  await screenshot("mobile-images-dark-en");
  await phone.reload(); await phone.locator(".grant-open").waitFor();
  check("phone reload restores login and pairing");
  await closeDesktop();
  await phone.getByRole("button", { name: "Refresh", exact: true }).click();
  await phone.getByText("Desktop offline", { exact: false }).first().waitFor();
  check("desktop shutdown reports offline without queueing requests");
  await openDesktop(); await until(() => fixture.desktops.size > 0, "desktop relay restart");
  await phone.getByRole("button", { name: "Refresh", exact: true }).click(); await phone.locator(".grant-open").first().click();
  await phone.locator(".image-result .attachment-preview").first().click();
  await phone.locator(".image-result img").first().waitFor();
  check("desktop restart retains shared image history");
  await page.locator('[data-nav="settings"]').click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.locator('[data-testid="mobile-sync-settings"]').waitFor();
  await page.locator('[data-action="revoke-mobile-grant"]').first().click();
  await page.locator('[data-action="confirm-mobile-revoke"]').click();
  await until(() => fixture.peers.size === 0, "grant revoked");
  check("revocation closes mobile access immediately");
  await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.disconnect()); await phone.getByRole("button", { name: "Refresh", exact: true }).click();
  await until(() => phone.locator(".grant-open").count().then((count) => count === 0), "revoked listing removed");
  check("revoked work disappears from phone");
  await screenshot("desktop-sync-manager-dark-en", page);
  await page.locator('[data-nav="back-to-app"]').click();
  const projectPath = join(output, "shared-project"); await mkdir(projectPath, { recursive: true });
  const project = (await invoke("project-group/create", { name: "Mobile project", folders: [projectPath] })).group;
  const projectSession = (await invoke("session/create", { title: "Existing project session", projectPath, providerId: provider.id, modelId: "gpt-5", mode: "agent" })).session;
  await invoke("project/set", projectPath);
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(".project-group").filter({ has: page.locator(`[data-sidebar-session-row="${projectSession.id}"]`) }).locator(".sidebar-session-group-header").click({ button: "right" });
  await page.locator('[data-action="sync-project-mobile"]').click();
  await page.locator('[data-testid="mobile-pairing-code"]').waitFor();
  const projectCode = (await page.locator('[data-testid="mobile-pairing-code"]').textContent()).trim();
  await pairPhone(projectCode); await phone.locator(".grant-open").filter({ hasText: "Mobile project" }).click();
  await phone.getByRole("button").filter({ hasText: "Existing project session" }).waitFor();
  check("project share includes existing sessions with stable project identity", (await view()).grant.scope.id === project.id && (await view()).sessions.some((session) => session.id === projectSession.id));
  await invoke("session/create", { title: "Future project session", projectPath, providerId: provider.id, modelId: "gpt-5", mode: "agent" });
  await phone.getByRole("button").filter({ hasText: "Future project session" }).waitFor({ timeout: 25_000 });
  check("project share includes future sessions without pairing again");
  await page.locator('[data-action="close-mobile-pairing"]').click();
  await phone.getByRole("button", { name: "Account and appearance", exact: true }).click();
  await phone.getByRole("button", { name: "Light", exact: true }).click();
  await phone.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await phone.getByRole("button", { name: "关闭", exact: true }).click();
  await phone.setViewportSize({ width: 320, height: 640 });
  await screenshot("mobile-project-light-zh-narrow");
  await phone.getByRole("button").filter({ hasText: "Existing project session" }).click();
  await until(async () => !(await view()).loading && (await view()).snapshot?.session.id === projectSession.id, "narrow conversation loaded");
  await phone.getByRole("textbox").fill("手机窄屏草稿");
  await screenshot("mobile-conversation-light-zh-narrow");
  await phone.locator(".conversation-controls .config-chip").first().click();
  await phone.getByRole("heading", { name: "选择模式", exact: true }).waitFor();
  check("narrow Chinese mode sheet uses translated interaction copy", await phone.getByText("先生成计划，再确认执行", { exact: true }).count() === 1);
  await screenshot("mobile-mode-light-zh-narrow");
  await phone.keyboard.press("Escape"); await phone.locator(".surface").waitFor({ state: "hidden" });
  await phone.locator(".conversation-controls .model-chip").click();
  await phone.getByRole("heading", { name: "选择模型", exact: true }).waitFor();
  check("narrow Chinese model sheet exposes translated reasoning controls", await phone.getByLabel("推理等级", { exact: true }).count() === 1);
  await screenshot("mobile-model-light-zh-narrow");
  await phone.keyboard.press("Escape"); await phone.locator(".surface").waitFor({ state: "hidden" });
  check("configuration sheets preserve the narrow-screen draft", await phone.getByRole("textbox").inputValue() === "手机窄屏草稿");
  check("no renderer exceptions", errors.length === 0);
} catch (error) {
  errors.push({ message: error.stack }); console.error(error);
  await page?.screenshot({ path: join(output, "desktop-failure.png") }).catch(() => undefined);
  await phone?.screenshot({ path: join(output, "mobile-failure.png") }).catch(() => undefined);
  if (phone) await writeFile(join(output, "mobile-visible.txt"), await phone.locator("body").innerText().catch(() => ""));
  if (phone) await writeFile(join(output, "mobile-state.json"), JSON.stringify(await view().catch(() => null), null, 2));
  process.exitCode = 1;
} finally {
  await closeDesktop().catch((error) => cleanupErrors.push(error.message));
  await browser?.close().catch((error) => cleanupErrors.push(error.message));
  await vite.close().catch((error) => cleanupErrors.push(error.message)); fixture.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ startedRevision, finishedRevision: revision(), passed, errors, cleanupErrors }, null, 2));
  console.log(`Mobile acceptance artifacts: ${output}`);
}
