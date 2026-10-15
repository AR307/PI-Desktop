import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mobileFixture } from "./fixture.mjs";
import { presetAppearance } from "./phone-ui.mjs";

// Long background delivery on a real Android runtime: the desktop starts work
// while the phone rests on its session list, the phone leaves the foreground
// (optionally screen off and Doze), and the completion must arrive as a system
// notification without reopening the app.
const require = createRequire(import.meta.url);
const { _electron, _android } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const runFile = promisify(execFile);
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `background-android-${Date.now()}`));
const androidHome = process.env.ANDROID_HOME;
if (!androidHome || !process.env.JAVA_HOME) throw new Error("ANDROID_HOME and JAVA_HOME are required");
const adbPath = join(androidHome, "platform-tools/adb.exe");
const serial = process.env.PI_ANDROID_SERIAL ?? "emulator-5554";
const appId = "xyz.mirrorcoding.pi.mobile";
// The desktop ends a stalled stream after about three minutes, so the wait stays below it.
const backgroundMs = Number(process.env.PI_ANDROID_BACKGROUND_MS ?? 120_000);
const doze = process.env.PI_ANDROID_DOZE !== "0";
const freeze = process.env.PI_ANDROID_FREEZE === "1";
const adb = (...args) => runFile(adbPath, ["-s", serial, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
await mkdir(output, { recursive: true });
const fixture = await mobileFixture({});
const passed = [], errors = [], timeline = [];
let desktop, page, device, phone;
const check = (name, result = true) => { assert(result, name); passed.push(name); console.log(`PASS ${name}`); };
const until = async (probe, label, timeout = 40_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await probe(); if (result) return result; await new Promise((done) => setTimeout(done, 250)); }
  throw new Error(`Timed out: ${label}`);
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
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
const notifications = async () => (await adb("shell", "dumpsys", "notification", "--noredact")).stdout;
const keepAliveText = (dump) => dump.match(/android\.title=String \(PI Mobile is listening\)[\s\S]*?android\.text=String \(([^)]*)\)/)?.[1];
/** Process states for the app and the WebView renderer it hosts. */
async function processes() {
  const listing = (await adb("shell", "ps", "-A", "-o", "PID,USER,S,WCHAN:24,NAME")).stdout.split("\n");
  return listing.filter((line) => line.includes(appId) || /sandboxed_process|webview/i.test(line)).map((line) => line.trim().replace(/\s+/g, " "));
}
async function sample(label) {
  const dump = await notifications();
  const entry = { at: new Date().toISOString(), label, keepAlive: keepAliveText(dump), completion: dump.includes("Done · Background acceptance"), processes: await processes() };
  timeline.push(entry); console.log(`SAMPLE ${label} keepAlive=${entry.keepAlive} completion=${entry.completion}`);
  return entry;
}
/** The app process and the WebView renderers; the QA emulator runs no other WebView app. */
async function appProcessIds() {
  const listing = (await adb("shell", "ps", "-A", "-o", "PID,NAME")).stdout.split("\n").map((line) => line.trim().split(/\s+/));
  const pids = listing.filter(([pid, name]) => /^\d+$/.test(pid ?? "") && (name === appId || /sandboxed_process/.test(name ?? ""))).map(([pid]) => pid);
  assert(pids.length >= 2, `app and renderer processes: ${pids.join(",")}`);
  return pids;
}
/** Stock Android: the kept-alive app handles the completion while it stays in the background. */
async function backgroundDelivery() {
  if (doze) {
    await adb("shell", "input", "keyevent", "223");
    await adb("shell", "dumpsys", "deviceidle", "force-idle").catch(() => undefined);
    await sample("screen off and idle");
  }
  const started = Date.now();
  while (Date.now() - started < backgroundMs) { await pause(Math.min(30_000, backgroundMs)); await sample(`background ${Math.round((Date.now() - started) / 1000)}s`); }
  fixture.releaseChats();
  const released = Date.now();
  const delivered = await until(async () => (await sample("after release")).completion, "completion notification while the app stays in the background", 90_000).catch((error) => { errors.push({ message: error.message }); return false; });
  if (delivered) console.log(`DELIVERED after ${Math.round((Date.now() - released) / 1000)}s`);
  const after = timeline.at(-1);
  check("keep-alive kept running in the background", Boolean(after.keepAlive));
  check("completion reaches the phone as a system notification without reopening it", delivered);
  check("keep-alive text followed the finished task in the background", after.keepAlive !== "Tasks in progress: 1");
}
/**
 * Vendor freezers (ColorOS, OriginOS, ...) stop the app and its WebView renderer
 * despite the foreground service, while their sockets stay open. Reproduce that
 * with the platform freezer, then check the app reports the held-back delivery.
 */
async function frozenDelivery() {
  const pids = await appProcessIds();
  for (const pid of pids) await adb("shell", "am", "freeze", "--sticky", pid);
  await sample("frozen");
  fixture.releaseChats();
  await pause(100_000);
  const frozen = await sample("frozen after the desktop finished");
  check("a frozen app shows neither the completion nor a keep-alive update, as vendor ROMs report", !frozen.completion && frozen.keepAlive === "Tasks in progress: 1");
  for (const pid of pids) await adb("shell", "am", "unfreeze", "--sticky", pid);
  await adb("shell", "am", "start", "-n", `${appId}/.MainActivity`);
  await phone.locator(".background-notice").getByText("Notifications arrived late", { exact: true }).waitFor({ timeout: 40_000 });
  const { stdout } = await runFile(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(output, "android-background-delayed.png"), stdout);
  check("returning to the app reports the held-back delivery and how to allow background activity");
  // The notice asks Android itself for the battery exemption.
  await phone.locator(".background-notice").getByRole("button", { name: "Allow background activity", exact: true }).click();
  await until(async () => /RequestIgnoreBatteryOptimizations/.test((await adb("shell", "dumpsys", "activity", "top")).stdout), "system battery exemption dialog");
  await tapNative("Allow");
  await until(async () => (await adb("shell", "dumpsys", "deviceidle", "whitelist")).stdout.includes(appId), "battery exemption granted");
  await phone.locator(".background-notice").getByRole("button", { name: "Allow background activity", exact: true }).waitFor({ state: "detached" });
  check("the notice requests the battery exemption through Android's dialog");
}
async function tapNative(text) {
  const node = await until(async () => {
    await adb("shell", "uiautomator", "dump", "/sdcard/pi-mobile-window.xml");
    return (await adb("shell", "cat", "/sdcard/pi-mobile-window.xml")).stdout.match(/<node\b[^>]*>/g)?.find((candidate) => candidate.includes(`text="${text}"`));
  }, `native control ${text}`, 20_000);
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert(bounds, `native bounds for ${text}`);
  await adb("shell", "input", "tap", String(Math.floor((+bounds[1] + +bounds[3]) / 2)), String(Math.floor((+bounds[2] + +bounds[4]) / 2)));
}
async function connectWebView() {
  device ??= (await _android.devices()).find((candidate) => candidate.serial() === serial);
  assert(device, `Android device ${serial}`);
  phone = await (await device.webView({ pkg: appId }, { timeout: 40_000 })).page();
  phone.setDefaultTimeout(25_000);
  phone.on("pageerror", (error) => errors.push({ surface: "android", message: error.message }));
  await phone.locator(".mobile-shell").waitFor();
}
try {
  if (process.env.PI_ANDROID_SKIP_BUILD !== "1") {
    await build("pnpm --filter @pi-desktop/mobile exec vite build --mode acceptance", root, "mobile-web");
    await build("pnpm --filter @pi-desktop/mobile android:sync", root, "capacitor-sync");
    await build("gradlew.bat assembleDebug --console=plain", join(root, "apps/mobile/android"), "android-build");
  }
  const port = new URL(fixture.origin).port;
  await adb("reverse", `tcp:${port}`, `tcp:${port}`);
  await adb("install", "-r", join(root, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"));
  await adb("shell", "pm", "grant", appId, "android.permission.POST_NOTIFICATIONS");
  // Every run starts under battery optimization, as a fresh installation is.
  await adb("shell", "dumpsys", "deviceidle", "whitelist", `-${appId}`).catch(() => undefined);
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
  const session = (await invoke("session/create", { title: "Background acceptance", providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", permissionMode: "ask", mode: "agent" })).session;
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(`[data-sidebar-session-row="${session.id}"]`).first().click({ button: "right" });
  await page.locator('[data-action="sync-session-mobile"]').click();
  const code = await until(async () => (await page.locator('[data-testid="mobile-pairing-code"]').textContent().catch(() => ""))?.trim(), "pairing code");
  await adb("shell", "am", "start", "-n", `${appId}/.MainActivity`); await connectWebView();
  await until(async () => !(await view()).loading, "initial account load");
  await presetAppearance(phone, { language: "en", theme: "light" });
  await until(async () => !(await view()).loading, "account load after preferences");
  if ((await view()).signedIn) await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.logout());
  await phone.locator('[name="username"]').fill("mobileqa");
  await phone.locator('[name="password"]').fill("mobile-pass");
  await phone.locator(".login-form button[type=submit]").click();
  await phone.getByRole("heading", { name: "Sessions", exact: true }).waitFor();
  await phone.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await phone.getByLabel("8-digit pairing code").fill(code);
  await phone.getByRole("button", { name: "Pair and sync", exact: true }).click();
  await phone.locator(".session-card").filter({ hasText: "Background acceptance" }).waitFor();
  await page.locator('[data-action="close-mobile-pairing"]').click();
  await until(async () => (await view()).notifications.permission === "granted", "notification permission");
  check("phone rests on the session list with notifications allowed");

  // The desktop starts the work; the phone only holds its directory subscription.
  await page.locator(`[data-sidebar-session-row="${session.id}"] .thread-item-main`).first().click();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("mobile-slow long task while the phone is away"); await editor.press("Enter");
  await until(async () => (await view()).notifications.activeTasks > 0, "phone sees the running desktop task");
  check("phone counts the desktop task before leaving the foreground");
  await adb("shell", "input", "keyevent", "3");
  await until(async () => /isForeground=true/.test((await adb("shell", "dumpsys", "activity", "services", `${appId}/.RelayKeepAliveService`)).stdout), "keep-alive foreground service", 20_000);
  await sample("home");
  if (freeze) await frozenDelivery();
  else await backgroundDelivery();
} catch (error) {
  errors.push({ message: error.stack }); console.error(error);
  process.exitCode = 1;
} finally {
  await adb("shell", "dumpsys", "deviceidle", "unforce").catch(() => undefined);
  await adb("shell", "input", "keyevent", "224").catch(() => undefined);
  if (desktop) { await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; }).catch(() => undefined); await desktop.close().catch(() => undefined); }
  fixture.close();
  await device?.close().catch(() => undefined);
  await writeFile(join(output, "report.json"), JSON.stringify({ backgroundMs, doze, freeze, passed, errors, timeline }, null, 2));
  console.log(`REPORT ${output}`);
}
