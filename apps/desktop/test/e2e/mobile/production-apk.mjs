import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Package the official-origin preview APK after the controlled native suite.
// The launch probe stops at the login screen and never submits to the real MC.
const require = createRequire(import.meta.url);
const { _android } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts/mobile-package"));
const serial = process.env.PI_ANDROID_SERIAL ?? "emulator-5554";
const adbPath = join(process.env.ANDROID_HOME, "platform-tools/adb.exe");
const appId = "xyz.mirrorcoding.pi.mobile";
const adb = (...args) => run(adbPath, ["-s", serial, ...args], { encoding: "utf8" });
await mkdir(output, { recursive: true });
let device;
const connect = async () => {
  device = (await _android.devices()).find((entry) => entry.serial() === serial);
  assert(device, "task Android device available");
  return (await device.webView({ pkg: appId })).page();
};
const build = async (command, cwd, name) => {
  const child = spawn(command, { cwd, shell: true, env: process.env });
  let log = "";
  child.stdout.on("data", (data) => { log += data; }); child.stderr.on("data", (data) => { log += data; });
  const code = await new Promise((done, fail) => { child.on("exit", done); child.on("error", fail); });
  await writeFile(join(output, `${name}.log`), log);
  assert.equal(code, 0, `${name}: ${log.slice(-2000)}`);
  console.log(`PASS ${name}`);
};
try {
  const apk = join(output, "pi-mobile-0.15.1-preview.apk");
  if (!process.argv.includes("--verify-installed")) {
  // Use the previous acceptance application's own logout flow to remove only its
  // controlled test credential before installing the official-origin package.
  const acceptancePage = await connect();
  assert(await acceptancePage.evaluate(() => Boolean(window.__PI_MOBILE_CONTROLLER__)), "existing app is the controlled acceptance package");
  await acceptancePage.getByRole("button", { name: /^(Account and appearance|账号与外观)$/ }).click();
  await acceptancePage.getByRole("dialog").getByRole("button", { name: /^(Sign out|退出登录)$/ }).click();
  await acceptancePage.locator('[name="username"]').waitFor({ timeout: 40_000 });
  await device.close(); device = undefined;
  await build("pnpm --filter @pi-desktop/mobile build", root, "mobile-production-web");
  await build("pnpm --filter @pi-desktop/mobile android:sync", root, "mobile-production-sync");
  await build("gradlew.bat assembleDebug --console=plain", join(root, "apps/mobile/android"), "mobile-preview-apk");
  await copyFile(join(root, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"), apk);
  await adb("install", "-r", apk);
  await adb("shell", "am", "start", "-n", `${appId}/.MainActivity`);
  }
  const page = await connect();
  const productionCalls = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname === "console.mirrorcoding.xyz") productionCalls.push(request.url()); });
  await page.locator('[name="username"]').waitFor();
  assert(await page.evaluate(() => !window.__PI_MOBILE_CONTROLLER__ && !window.__PI_MOBILE_TEST__), "production has no acceptance hooks");
  assert.equal(productionCalls.length, 0, "login screen does not submit to production");
  await page.screenshot({ path: join(output, "production-apk-webview-login.png") });
  const { stdout } = await run(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(output, "production-apk-login.png"), stdout);
  await writeFile(join(output, "package-report.json"), JSON.stringify({ apk, variant: "debug-signed preview, production web assets", appId, origin: "https://console.mirrorcoding.xyz", acceptanceHooks: false, installAndLaunch: "passed", productionLoginSubmitted: false }, null, 2));
  console.log(`PASS installed official-origin APK opens native login without test hooks: ${apk}`);
} finally { await device?.close(); }
