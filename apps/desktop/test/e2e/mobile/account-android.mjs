import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const runFile = promisify(execFile);

/** Native surface for the same account/history flow as the browser harness. */
export function accountAndroid({ root, output, fixture, playwright, check, until, errors, passed }) {
  const serial = process.env.PI_ANDROID_SERIAL ?? "emulator-5554";
  const appId = process.env.PI_ANDROID_ACCOUNT_APP_ID ?? "xyz.mirrorcoding.pi.mobile.accountqa";
  assert(appId.startsWith("xyz.mirrorcoding.pi.mobile.accountqa"), "Use an isolated account QA application ID");
  assert(process.env.ANDROID_HOME && process.env.JAVA_HOME, "ANDROID_HOME and JAVA_HOME are required");
  const adbPath = join(process.env.ANDROID_HOME, "platform-tools/adb.exe");
  const adb = (...args) => runFile(adbPath, ["-s", serial, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const port = new URL(fixture.origin).port;
  let device, phone, closing = false;
  const build = async (command, args, cwd, name, shell = false) => {
    console.log(`BUILD ${name}`);
    const child = spawn(command, args, { cwd, shell, env: { ...process.env,
      VITE_MC_ORIGIN: fixture.origin, VITE_MOBILE_UPDATE_MANIFEST_URL: `${fixture.origin}/mobile-update.json` } });
    let log = "";
    child.stdout.on("data", data => { log += data; }); child.stderr.on("data", data => { log += data; });
    const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
    await writeFile(join(output, `${name}.log`), log);
    assert.equal(code, 0, `${name}: ${log.slice(-4000)}`);
  };
  const connect = async () => {
    device = (await playwright._android.devices()).find(candidate => candidate.serial() === serial);
    assert(device, `Android device ${serial}`);
    phone = await (await device.webView({ pkg: appId }, { timeout: 45_000 })).page();
    phone.setDefaultTimeout(25_000);
    phone.on("pageerror", error => { if (!closing) errors.push({ surface: "android", message: error.message, after: passed.at(-1) }); });
    await phone.locator(".mobile-shell").waitFor();
    closing = false;
    return phone;
  };
  const launch = () => adb("shell", "am", "start", "-n", `${appId}/xyz.mirrorcoding.pi.mobile.MainActivity`);
  return {
    report: { platform: "Android emulator, native Capacitor WebView", serial, appId },
    async prepare() {
      if (process.env.PI_ANDROID_SKIP_BUILD !== "1") {
        const mobile = join(root, "apps/mobile");
        const mobileRequire = createRequire(join(mobile, "package.json"));
        const vite = join(dirname(mobileRequire.resolve("vite/package.json")), "bin/vite.js");
        const capacitor = join(dirname(mobileRequire.resolve("@capacitor/cli/package.json")), "bin/capacitor");
        await build(process.execPath, [vite, "build", "--mode", "acceptance"], mobile, "android-account-web");
        await build(process.execPath, [capacitor, "sync", "android"], mobile, "android-account-capacitor");
        await build("gradlew.bat", ["assembleDebug", "--offline", "--console=plain", "-Pkotlin.incremental=false", `-PpiMobileAcceptanceApplicationId=${appId}`, "-PpiMobileAcceptanceVersionCode=6"], join(mobile, "android"), "android-account-build", true);
      }
      await adb("reverse", `tcp:${port}`, `tcp:${port}`);
      await adb("install", "-r", join(root, "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"));
    },
    async open() {
      await launch(); await connect();
      check("actual Capacitor Android runtime", await phone.evaluate(() => window.Capacitor.isNativePlatform()));
      await until(async () => !(await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot())).loading, "Android account restored");
      await phone.getByRole("button", { name: /^(Account and appearance|账号与外观)$/ }).click();
      await phone.getByLabel(/^(Language|语言)$/).selectOption("en");
      await phone.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Dark", exact: true }).click();
      await phone.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      await phone.locator(".surface").waitFor({ state: "hidden" });
      if (await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.getSnapshot().signedIn)) {
        await phone.evaluate(() => window.__PI_MOBILE_CONTROLLER__.logout());
      }
      return phone;
    },
    async restart() {
      closing = true;
      await device?.close(); device = undefined;
      await adb("shell", "am", "force-stop", appId);
      await launch();
      return connect();
    },
    async offline(enabled) {
      // Redirect only this test fixture's connection. Other installed apps and
      // the emulator's network remain unchanged throughout offline acceptance.
      await adb("reverse", `tcp:${port}`, `tcp:${enabled ? "1" : port}`);
      if (enabled) fixture.disconnectPhones();
    },
    async screenshot(name) {
      const result = await runFile(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
      await writeFile(join(output, `${name}.png`), result.stdout);
    },
    async close() {
      closing = true;
      await device?.close();
      await adb("shell", "am", "force-stop", appId);
      await adb("reverse", `tcp:${port}`, `tcp:${port}`);
    },
  };
}
