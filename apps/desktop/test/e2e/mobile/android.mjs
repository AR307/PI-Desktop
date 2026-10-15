import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mobileFixture } from "./fixture.mjs";
import { changeAppearance, closeConversation, openSharedSession, openTab, presetAppearance } from "./phone-ui.mjs";

const require = createRequire(import.meta.url);
const { _electron, _android } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const runFile = promisify(execFile);
const root = resolve(import.meta.dirname, "../../../../..");
const candidate = (await runFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
const baseMain = (await runFile("git", ["rev-parse", "origin/main"], { cwd: root })).stdout.trim();
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `android-${Date.now()}`));
const androidHome = process.env.ANDROID_HOME;
if (!androidHome || !process.env.JAVA_HOME) throw new Error("ANDROID_HOME and JAVA_HOME are required");
const adbPath = join(androidHome, "platform-tools/adb.exe");
const serial = process.env.PI_ANDROID_SERIAL ?? "emulator-5554";
const appId = "xyz.mirrorcoding.pi.mobile";
const adb = (...args) => runFile(adbPath, ["-s", serial, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
await mkdir(output, { recursive: true });
const fixture = await mobileFixture({ encryptedLogin: true });
const passed = [], errors = [];
let desktop, page, device, phone, closing = false;
const check = (name, result = true) => { assert(result, name); passed.push(name); console.log(`PASS ${name}`); };
const until = async (probe, label, timeout = 40_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await probe(); if (result) return result; await new Promise((done) => setTimeout(done, 150)); }
  throw new Error(`Timed out: ${label}`);
};
const build = async (command, cwd, name) => {
  console.log(`BUILD ${name}`);
  const child = spawn(command, { cwd, shell: true, env: { ...process.env, VITE_MC_ORIGIN: fixture.origin } });
  let log = "";
  child.stdout.on("data", (data) => { log += data; }); child.stderr.on("data", (data) => { log += data; });
  const code = await new Promise((done, fail) => { child.on("exit", done); child.on("error", fail); });
  await writeFile(join(output, `${name}.log`), log);
  assert.equal(code, 0, `${name}: ${log.slice(-3000)}`);
};
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
const view = () => phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot());
async function connectWebView() {
  device ??= (await _android.devices()).find((candidate) => candidate.serial() === serial);
  assert(device, `Android device ${serial}`);
  phone = await (await device.webView({ pkg: appId }, { timeout: 40_000 })).page();
  phone.setDefaultTimeout(25_000);
  phone.on("pageerror", (error) => { if (!closing) errors.push({ surface: "android", message: error.message, after: passed.at(-1) }); });
  await phone.locator(".mobile-shell").waitFor();
}
async function screenshot(name) {
  await phone.evaluate(() => Promise.allSettled(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished)));
  const { stdout } = await runFile(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(output, `${name}.png`), stdout);
  check(`${name}: no horizontal overflow`, await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
/** Wait for a native (non-WebView) element by its text or description. */
async function findNative(text, resourceId) {
  return until(async () => {
    await adb("shell", "uiautomator", "dump", "/sdcard/pi-mobile-window.xml");
    const result = (await adb("shell", "cat", "/sdcard/pi-mobile-window.xml")).stdout;
    return result.match(/<node\b[^>]*>/g)?.find((node) => (!resourceId || node.includes(`resource-id="${resourceId}"`)) && (node.includes(`text="${text}"`) || node.includes(`content-desc="${text}"`)));
  }, `native control ${text}`, 20_000);
}
async function tapNative(text, resourceId) {
  const xml = await findNative(text, resourceId);
  const bounds = xml.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert(bounds, `Native bounds for ${text}`);
  await adb("shell", "input", "tap", String(Math.floor((+bounds[1] + +bounds[3]) / 2)), String(Math.floor((+bounds[2] + +bounds[4]) / 2)));
}
async function send(text) {
  await phone.locator(".composer textarea").fill(text);
  await phone.getByRole("button", { name: "Send", exact: true }).click();
}
try {
  await build("pnpm --filter @pi-desktop/mobile exec vite build --mode acceptance", root, "mobile-web");
  await build("pnpm --filter @pi-desktop/mobile android:sync", root, "capacitor-sync");
  await build("gradlew.bat assembleDebug --console=plain", join(root, "apps/mobile/android"), "android-build");
  const port = new URL(fixture.origin).port;
  await adb("reverse", `tcp:${port}`, `tcp:${port}`);
  await adb("install", "-r", join(root, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"));
  // Every run starts from Android's first-request notification permission state.
  await adb("shell", "pm", "revoke", appId, "android.permission.POST_NOTIFICATIONS").catch(() => undefined);
  await adb("shell", "pm", "clear-permission-flags", appId, "android.permission.POST_NOTIFICATIONS", "user-set", "user-fixed").catch(() => undefined);
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "desktop-profile"), PI_DESKTOP_HOST_BIN: join(root, "target/debug/pi-desktop-host-core.exe"), PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`], env, timeout: 60_000 });
  page = await until(async () => { for (const candidate of desktop.windows()) if (await candidate.locator(".app-shell:not(.app-shell-boot)").count()) return candidate; }, "desktop shell", 60_000);
  await desktop.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__authUrl = url; }; });
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  await fetch(await until(() => desktop.evaluate(() => globalThis.__authUrl), "browser login"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "desktop authorized");
  const provider = (await invoke("providers/list")).providers.find((item) => item.mirrorCoding?.groupId === "中文 分组");
  await invoke("settings/set", { ...await invoke("settings/get"), defaultProviderId: provider.id, defaultModelId: "gpt-5", language: "en", theme: "dark" });
  const session = (await invoke("session/create", { title: "Android acceptance", providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "agent" })).session;
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(`[data-sidebar-session-row="${session.id}"]`).first().click({ button: "right" });
  await page.locator('[data-action="sync-session-mobile"]').click();
  const code = await until(async () => (await page.locator('[data-testid="mobile-pairing-code"]').textContent().catch(() => ""))?.trim(), "pairing code");
  await adb("shell", "am", "start", "-n", `${appId}/.MainActivity`); await connectWebView();
  check("actual Capacitor Android runtime", await phone.evaluate(() => window.Capacitor.isNativePlatform()));
  // Each acceptance launch uses a separate fixture. Clear stale test login through
  // the application's account workflow, never Android data or native storage APIs.
  await until(async () => !(await view()).loading, "initial account load");
  await presetAppearance(phone, { language: "en", theme: "light" });
  await until(async () => !(await view()).loading, "account load after preferences");
  if ((await view()).signedIn) await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.logout());
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  fixture.control.rateLimitOnce = "/api/pi-mobile/auth/login";
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("alert").filter({ hasText: "rate limited" }).waitFor();
  check("native login explains HTTP 429 and Retry-After", (await phone.getByRole("alert").textContent()).includes("Try again after"));
  await screenshot("android-login-rate-limited");
  await until(() => phone.evaluate(() => Date.now() >= window.__PI_MOBILE_CONTROLLER__.getSnapshot().retryAt), "native login cooldown");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("heading", { name: "Sessions", exact: true }).waitFor();
  check("native password login and secure credential write");
  check("native login uses MC-declared RSA-OAEP-256 without plaintext", fixture.control.encryptedLogins === 1);
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").click();
  await until(async () => /mInputShown=true|isInputViewShown=true/.test((await adb("shell", "dumpsys", "input_method")).stdout), "pairing keyboard");
  await adb("shell", "input", "keyevent", "4");
  await until(async () => !/mInputShown=true|isInputViewShown=true/.test((await adb("shell", "dumpsys", "input_method")).stdout), "pairing keyboard dismissed");
  await adb("shell", "input", "keyevent", "4");
  await until(async () => !await phone.getByRole("dialog").count(), "Android Back closes pairing");
  check("Android Back dismisses pairing without minimizing app");
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".session-card").filter({ hasText: "Android acceptance" }).click();
  await phone.locator(".composer textarea").waitFor();
  await screenshot("android-paired-light-en");
  await phone.locator(".conversation-controls .model-chip").click();
  await phone.getByLabel("Thinking level", { exact: true }).selectOption("ultra");
  await phone.getByRole("switch", { name: "Fast", exact: true }).check();
  await phone.locator(".fast-config").scrollIntoViewIfNeeded();
  await screenshot("android-fast-panel");
  await screenshot("android-ultra-panel");
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await phone.locator(".surface").waitFor({ state: "hidden" });
  await send("Continuation sent from the actual Android APK");
  await until(async () => (await invoke("session/get", { id: session.id })).session.messages.some((message) => message.role === "assistant"), "native continuation");
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "native turn complete");
  check("Android sends through MC relay to desktop and receives reply");
  check("Android Ultra persists and sends only native reasoning", (await invoke("session/get", { id: session.id })).session.ultra === true && fixture.chats.some(body => body.reasoning_effort === "high") && fixture.chats.every(body => body.reasoning_effort !== "ultra"));
  check("Android Fast setting persists and reaches actual request", (await invoke("session/get", { id: session.id })).session.fast === true && fixture.chats.some((body) => body.service_tier === "fast"));
  // Attention on the real device: the permission prompt, the background
  // keep-alive service, a posted system notification and its tap route.
  await closeConversation(phone);
  await openTab(phone, "Activity");
  await phone.getByRole("button", { name: "Turn on", exact: true }).click();
  await tapNative("Allow", "com.android.permissioncontroller:id/permission_allow_button");
  await until(async () => (await view()).notifications.permission === "granted", "notification permission granted");
  check("Activity banner requests Android notification permission");
  await openSharedSession(phone, "Android acceptance");
  await send("mobile-slow finish while the phone is in the background");
  // The phone's own send counts as work before the desktop row reports it.
  await until(async () => (await view()).notifications.activeTasks > 0, "keep-alive wanted for the sent prompt");
  await adb("shell", "input", "keyevent", "3");
  const keepAlive = async () => (await adb("shell", "dumpsys", "activity", "services", `${appId}/.RelayKeepAliveService`)).stdout;
  await until(async () => /isForeground=true/.test(await keepAlive()), "keep-alive foreground service", 20_000);
  await writeFile(join(output, "android-keep-alive-service.txt"), await keepAlive());
  check("leaving the app right after sending starts the keep-alive foreground service");
  fixture.releaseChats();
  const posted = async () => (await adb("shell", "dumpsys", "notification", "--noredact")).stdout;
  await until(async () => (await posted()).includes("Done · Android acceptance"), "background completion notification");
  await writeFile(join(output, "android-notifications.txt"), await posted());
  check("background completion posts an Android notification");
  await adb("shell", "cmd", "statusbar", "expand-notifications");
  await findNative("Done · Android acceptance");
  await screenshot("android-notification-shade");
  await tapNative("Done · Android acceptance");
  await phone.locator(".conversation-heading strong").filter({ hasText: "Android acceptance" }).waitFor();
  await until(async () => !/isForeground=true/.test(await keepAlive()), "keep-alive stops in the foreground", 20_000);
  check("notification tap opens the conversation and the foreground stops keep-alive", (await view()).selectedId === session.id);
  // A trusted pointer click focuses the actual WebView input and opens the IME.
  await phone.locator(".composer textarea").click();
  await until(async () => /mInputShown=true|isInputViewShown=true/.test((await adb("shell", "dumpsys", "input_method")).stdout), "Android soft keyboard");
  await phone.evaluate(async () => {
    await new Promise((done) => {
      let previous = 0, stable = 0;
      const frame = () => {
        const height = visualViewport?.height ?? innerHeight;
        stable = Math.abs(height - previous) < 1 ? stable + 1 : 0;
        previous = height;
        if (stable >= 12) done(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
  await screenshot("android-soft-keyboard");
  const inputBox = await phone.locator(".composer textarea").boundingBox();
  const viewportBottom = await phone.evaluate(() => (visualViewport?.height ?? innerHeight) + (visualViewport?.offsetTop ?? 0));
  check("composer remains visible above Android keyboard", inputBox.y + inputBox.height <= viewportBottom + 1);
  await adb("shell", "input", "keyevent", "4");
  await phone.locator(".composer textarea").fill("Draft survives background and foreground");
  await adb("shell", "input", "keyevent", "3");
  await adb("shell", "am", "start", "-n", `${appId}/.MainActivity`);
  await until(async () => (await view()).connection === "connected", "foreground reconnect");
  check("Android foreground restores relay and keeps draft", await phone.locator(".composer textarea").inputValue() === "Draft survives background and foreground");
  const reference = join(output, "pi-android-reference.png"); await writeFile(reference, fixture.upstream.bytes);
  await adb("push", reference, "/sdcard/Download/pi-android-reference.png");
  await phone.getByRole("button", { name: "Attach photos or files", exact: true }).click();
  await tapNative("Show roots"); await tapNative("Downloads", "android:id/title"); await tapNative("pi-android-reference.png");
  await phone.getByText("pi-android-reference.png", { exact: true }).waitFor();
  await send("Photo chosen through the Android system file picker");
  await until(async () => (await invoke("session/get", { id: session.id })).session.messages.some((message) => message.content === "Photo chosen through the Android system file picker" && message.attachments?.length), "native attachment");
  await until(async () => !(await view()).busy && !(await view()).snapshot?.activeTurn, "attachment turn complete");
  check("native system picker uploads photo as durable desktop attachment");
  await invoke("image/configure", { key: session.id, config: { active: true, providerId: provider.id, modelId: "gpt-image-1", options: { count: 1, size: "1024x1024" } } });
  await phone.getByLabel("Describe an image…").waitFor();
  await send("A calm landscape generated on the computer from Android");
  await phone.locator(".image-result .attachment-preview").first().click();
  await phone.locator(".image-result img").first().waitFor();
  check("Android follows desktop image mode and displays generated attachment", fixture.upstream.calls.at(-1).group === encodeURIComponent("中文 分组"));
  await phone.locator(".image-result .image-preview-button").first().click();
  await phone.getByRole("dialog").waitFor(); await screenshot("android-image-preview");
  await adb("shell", "input", "keyevent", "4");
  await until(async () => !await phone.getByRole("dialog").count(), "preview closed");
  check("Android Back closes image preview in place");
  await phone.locator(".image-result").getByRole("button", { name: "Save / share", exact: true }).first().click();
  await until(async () => /ACTIVITY com.android.intentresolver\/.*ChooserActivity/.test((await adb("shell", "dumpsys", "activity", "top")).stdout), "native image share sheet");
  await screenshot("android-image-share-sheet"); await adb("shell", "input", "keyevent", "4");
  check("generated image opens Android system save/share sheet");
  await phone.locator(".image-result").getByRole("button", { name: "Use as reference", exact: true }).first().click();
  await send("Make a second image using the generated reference");
  await until(() => fixture.upstream.calls.length >= 2, "reference image request");
  check("Android generated image can be used as a reference", fixture.upstream.calls.at(-1).path.endsWith("/images/edits"));
  await until(async () => !(await view()).busy && !(await view()).snapshot?.imageJobs.some((job) => job.status === "running"), "image completed");
  closing = true; await device.close(); device = undefined;
  await adb("shell", "am", "force-stop", appId);
  await adb("shell", "am", "start", "-n", `${appId}/.MainActivity`); await connectWebView(); closing = false;
  await phone.locator(".session-card").filter({ hasText: "Android acceptance" }).waitFor();
  check("Android process restart restores encrypted login and pairing");
  await phone.locator(".session-card").filter({ hasText: "Android acceptance" }).click();
  await phone.getByText("Continuation sent from the actual Android APK", { exact: true }).waitFor();
  check("Android restart reloads durable desktop history");
  await until(async () => (await view()).snapshot?.session.id === session.id, "restored authoritative session snapshot");
  check("Android restart restores remembered chat Ultra", (await view()).snapshot.session.configuration.chat.ultra === true);
  await closeConversation(phone);
  await changeAppearance(phone, { theme: "Dark", language: "zh-CN" });
  await screenshot("android-sessions-dark-zh");
  await openSharedSession(phone, "Android acceptance");
  await screenshot("android-conversation-dark-zh");
  check("no native WebView exceptions", errors.length === 0);
} catch (error) {
  errors.push({ message: error.stack }); console.error(error);
  if (phone) await screenshot("android-failure").catch(() => undefined);
  await writeFile(join(output, "android-logcat.txt"), (await adb("logcat", "-d", "-t", "500")).stdout).catch(() => undefined);
  process.exitCode = 1;
} finally {
  closing = true;
  if (desktop) { await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; }); await desktop.close(); }
  fixture.close();
  await device?.close();
  await writeFile(join(output, "report.json"), JSON.stringify({ candidate, baseMain, passed, errors, fixture: "local controlled boundary", platform: "Android emulator, native Capacitor WebView", serial }, null, 2));
  console.log(`REPORT ${output}`);
}
