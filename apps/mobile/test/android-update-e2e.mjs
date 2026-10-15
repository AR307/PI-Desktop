import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

// In-app Android updates across consecutive releases on a dedicated QA package:
// download, cancel, retry and restart; a newer release while an older APK waits;
// the system installer; and the next release after an installed update. An APK
// left from an earlier update must never be offered for installation again.
const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, process.env.PI_ANDROID_UPDATE_OUTPUT ?? ".artifacts/mobile-update-qa");
if (!process.env.ANDROID_HOME || !process.env.JAVA_HOME) throw new Error("ANDROID_HOME and JAVA_HOME are required");
const adbPath = resolve(process.env.ANDROID_HOME, "platform-tools/adb.exe");
const serial = process.env.PI_ANDROID_SERIAL ?? "emulator-5554";
const appId = process.env.PI_ANDROID_UPDATE_APP_ID ?? "xyz.mirrorcoding.pi.mobile.updateqa";
const base = Number(process.env.PI_ANDROID_UPDATE_VERSION_CODE ?? 100);
const codes = [base, base + 1, base + 2];
const port = 38479;
const adb = async (...args) => (await run(adbPath, ["-s", serial, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const apkFile = (code) => join(output, `update-${code}.apk`);
const versionName = (code) => `0.20.${code}`;
async function until(probe, label, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await pause(250);
  }
  throw new Error(`Timed out: ${label}`);
}
async function screenshot(name) {
  await pause(450);
  const { stdout } = await run(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  await writeFile(join(output, `${name}.png`), stdout);
}
async function build(command, cwd, name, env = {}) {
  console.log(`BUILD ${name}`);
  const childEnv = { ...process.env, ...env };
  delete childEnv.NoDefaultCurrentDirectoryInExePath;
  const child = spawn(command, { cwd, shell: true, env: childEnv });
  let log = "";
  child.stdout.on("data", (data) => { log += data; }); child.stderr.on("data", (data) => { log += data; });
  const code = await new Promise((done, fail) => { child.on("exit", done); child.on("error", fail); });
  await writeFile(join(output, `${name}.log`), log);
  assert.equal(code, 0, `${name}: ${log.slice(-3000)}`);
}

await mkdir(output, { recursive: true });
if (process.env.PI_ANDROID_SKIP_BUILD !== "1") {
  const mobile = join(root, "apps/mobile");
  // The account service points at this local server too, so the QA app never reaches production MC.
  await build("pnpm --filter @pi-desktop/mobile exec vite build --mode acceptance", root, "update-web", { VITE_MOBILE_UPDATE_MANIFEST_URL: `http://127.0.0.1:${port}/mobile-update.json`, VITE_MC_ORIGIN: `http://127.0.0.1:${port}` });
  await build("pnpm --filter @pi-desktop/mobile android:sync", root, "update-sync");
  for (const code of codes) {
    await build(`.\\gradlew.bat assembleDebug --console=plain -PpiMobileAcceptanceApplicationId=${appId} -PpiMobileAcceptanceVersionCode=${code}`, join(mobile, "android"), `update-apk-${code}`);
    await copyFile(join(mobile, "android/app/build/outputs/apk/debug/app-debug.apk"), apkFile(code));
  }
}

// The server offers one release at a time; tests move it forward.
let offered = base + 1;
const apkRequests = new Map();
const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/")) {
    // Seeded credentials are synthetic: report the account service as temporarily
    // unavailable, which keeps them, instead of letting a real service reject them.
    response.writeHead(request.method === "OPTIONS" ? 204 : 503, { "Access-Control-Allow-Origin": request.headers.origin ?? "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Retry-After": "300", "Content-Type": "application/json" });
    response.end(request.method === "OPTIONS" ? undefined : JSON.stringify({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "QA account service" } }));
    return;
  }
  if (request.url === "/mobile-update.json") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ versionName: versionName(offered), versionCode: offered, minAndroidSdk: 24,
      apkUrl: `http://127.0.0.1:${port}/update-${offered}.apk`, releaseNotes: `Controlled Android update ${offered}` }));
    return;
  }
  const match = request.url?.match(/^\/update-(\d+)\.apk$/);
  if (!match) { response.writeHead(404); response.end(); return; }
  const code = Number(match[1]);
  apkRequests.set(code, (apkRequests.get(code) ?? 0) + 1);
  const bytes = await readFile(apkFile(code)).catch(() => null);
  if (!bytes) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Length": bytes.length });
  for (let offset = 0; offset < bytes.length && !response.destroyed; offset += 64 * 1024) {
    response.write(bytes.subarray(offset, offset + 64 * 1024));
    await pause(40);
  }
  response.end();
});
await new Promise((done) => server.listen(port, "127.0.0.1", done));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const promise = this.pending.get(message.id);
      if (!promise) return;
      this.pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error.message));
      else promise.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((done, fail) => {
      this.pending.set(id, { resolve: done, reject: fail });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }
  /** Tap the first visible button whose text includes `text`, inside `scope` when given. */
  async tapButton(text, scope = "body") {
    const rect = await this.evaluate(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(scope)} + " button")].find((candidate) => candidate.offsetParent && candidate.textContent.includes(${JSON.stringify(text)}));
      if (!button) return null;
      button.scrollIntoView({ block: "center" });
      const r = button.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    assert(rect, `Missing button ${text}`);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }
  /** Text of the update section's primary action, or null when it offers none. */
  action() { return this.evaluate("document.querySelector('.update-actions button')?.textContent ?? null"); }
  status() { return this.evaluate("[...document.querySelectorAll('.update-status')].map((node) => node.textContent).join(' | ')"); }
  close() { this.socket.close(); }
}
async function connectWebview() {
  const pid = (await adb("shell", "pidof", appId)).trim();
  assert(pid, "QA app process is running");
  await adb("forward", "tcp:39223", `localabstract:webview_devtools_remote_${pid}`);
  const tabs = await (await fetch("http://127.0.0.1:39223/json")).json();
  const tab = tabs.find((candidate) => candidate.type === "page");
  assert(tab?.webSocketDebuggerUrl, "Capacitor WebView debug socket");
  const socket = new WebSocket(tab.webSocketDebuggerUrl.replace("localhost", "127.0.0.1"));
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  const cdp = new Cdp(socket);
  await cdp.send("Runtime.enable");
  return cdp;
}
/** Launch the QA app and open its update section: on the login page, or in Me once signed in. */
async function openApp(label) {
  await adb("shell", "am", "start", "-n", `${appId}/xyz.mirrorcoding.pi.mobile.MainActivity`);
  const cdp = await until(async () => connectWebview().catch(() => null), `${label} WebView`);
  await until(() => cdp.evaluate("Boolean(document.querySelector('.mobile-shell') && (document.querySelector('.login-form') || document.querySelector('.tab-bar')))"), `${label} shell`);
  if (await cdp.evaluate("Boolean(document.querySelector('.tab-bar'))")) await cdp.tapButton("Me", ".tab-bar");
  await until(() => cdp.evaluate("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Check for updates'))"), `${label} update section`);
  return cdp;
}
async function checkForUpdates(cdp) {
  await cdp.tapButton("Check for updates");
  await until(async () => !(await cdp.evaluate("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Checking'))")), "update check finished");
}
async function nativeNodes() {
  await adb("shell", "uiautomator", "dump", "/sdcard/pi-update-window.xml");
  const xml = await adb("shell", "cat", "/sdcard/pi-update-window.xml");
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => match[0]);
}
async function tapNative(match) {
  const node = await until(async () => (await nativeNodes()).find(match), "native control", 25_000);
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert(bounds, `No bounds: ${node}`);
  await adb("shell", "input", "tap", String(Math.floor((+bounds[1] + +bounds[3]) / 2)), String(Math.floor((+bounds[2] + +bounds[4]) / 2)));
}
const installed = async () => Number((await adb("shell", "dumpsys", "package", appId)).match(/versionCode=(\d+)/)?.[1]);
const installer = (node) => node.includes('text="Update"') || node.includes('text="Install"');

let cdp;
try {
  await adb("reverse", `tcp:${port}`, `tcp:${port}`);
  // A fresh QA package: no earlier DownloadManager job or install permission.
  await adb("uninstall", appId).catch(() => undefined);
  await adb("install", apkFile(base));
  cdp = await openApp("first launch");
  await until(() => cdp.evaluate("Boolean(window.__PI_MOBILE_PERSISTENCE_TEST__)"), "native persistence acceptance hook");
  await cdp.evaluate("window.__PI_MOBILE_PERSISTENCE_TEST__.seed()");
  assert.deepEqual(await cdp.evaluate("window.__PI_MOBILE_PERSISTENCE_TEST__.verify()"), { credentials: true, pairing: true, directory: true, history: true });
  console.log("PASS native credentials, pairing and history saved before updates");
  await checkForUpdates(cdp);
  await until(async () => (await cdp.status()).includes(`Version ${versionName(base + 1)} is available`), "first update offered");
  await screenshot("01-update-available");
  console.log("PASS update offered before sign-in");

  await cdp.tapButton("Download update");
  await until(() => cdp.evaluate("document.querySelector('.update-progress progress')?.value > 0"), "download progress");
  await screenshot("02-download-progress");
  await cdp.tapButton("Cancel download");
  await until(() => cdp.evaluate("!document.querySelector('.update-progress')"), "cancelled download");
  await cdp.tapButton("Download update");
  await until(() => cdp.evaluate("Boolean(document.querySelector('.update-progress'))"), "retried download");
  console.log("PASS progress, cancel and retry");
  await adb("shell", "am", "force-stop", appId);
  cdp.close();
  cdp = await openApp("restarted");
  await until(async () => (await cdp.action())?.includes("Install update"), "download completed across restart", 60_000);
  assert((apkRequests.get(base + 1) ?? 0) >= 2, "the APK was fetched again after cancellation");
  await screenshot("03-download-complete");
  console.log("PASS DownloadManager job survives the restart");

  // Regression: a newer release while the previous APK waits must be downloaded, not the waiting APK installed.
  offered = base + 2;
  await checkForUpdates(cdp);
  await until(async () => (await cdp.status()).includes(`Version ${versionName(base + 2)} is available`), "newer release offered");
  await until(async () => (await cdp.action())?.includes("Download update"), "newer release needs its own download");
  await screenshot("04-newer-release-download");
  console.log("PASS a newer release discards the APK downloaded for the previous one");
  await cdp.tapButton("Download update");
  await until(async () => (await cdp.action())?.includes("Install update"), "newer release downloaded", 60_000);
  assert.equal(apkRequests.get(base + 2), 1, "the newer APK was downloaded once");

  await cdp.tapButton("Install update");
  const nativeStep = await until(async () => {
    const nodes = await nativeNodes();
    if (nodes.some((node) => node.includes('text="Allow from this source"'))) return "permission";
    if (nodes.some(installer)) return "installer";
    return null;
  }, "Android permission or installer");
  if (nativeStep === "permission") {
    await screenshot("05-unknown-source-settings");
    await tapNative((node) => node.includes('text="Allow from this source"'));
    await adb("shell", "input", "keyevent", "4");
  }
  await until(async () => (await nativeNodes()).some(installer), "system installer");
  await screenshot("06-system-installer");
  await adb("shell", "input", "keyevent", "4");
  await until(async () => (await installed()) === base, "installer cancellation keeps the installed version");
  cdp.close();
  cdp = await openApp("after installer cancellation");
  await until(() => cdp.evaluate("Boolean(window.__PI_MOBILE_PERSISTENCE_TEST__)"), "persistence hook after installer cancellation");
  assert.deepEqual(await cdp.evaluate("window.__PI_MOBILE_PERSISTENCE_TEST__.verify()"), { credentials: true, pairing: true, directory: true, history: true });
  console.log("PASS cancelling system installation returns to the app with data intact");
  await until(async () => (await cdp.action())?.includes("Install update"), "install action after cancellation");
  await cdp.tapButton("Install update");
  await until(async () => (await nativeNodes()).some(installer), "system installer reopened");
  await tapNative(installer);
  await until(async () => (await installed()) === base + 2, "newer release installed", 60_000);
  // Close the installer's "App installed" result so later captures show the app.
  await tapNative((node) => node.includes('text="Done"')).catch(() => undefined);
  cdp.close();
  cdp = await openApp("upgraded");
  await until(() => cdp.evaluate("Boolean(window.__PI_MOBILE_PERSISTENCE_TEST__)"), "upgraded persistence hook");
  assert.deepEqual(await cdp.evaluate("window.__PI_MOBILE_PERSISTENCE_TEST__.verify()"), { credentials: true, pairing: true, directory: true, history: true });
  await checkForUpdates(cdp);
  await until(async () => (await cdp.status()).includes("You are using the latest version"), "upgraded app is current");
  assert.equal(await cdp.action(), null, "no install action remains after the update");
  await screenshot("07-upgraded-current");
  console.log(`PASS system installer upgraded to code ${base + 2}; credentials, pairing and history retained`);

  // Regression: the next release after an installed update needs a new download, not the installed APK.
  offered = base + 3;
  await checkForUpdates(cdp);
  await until(async () => (await cdp.status()).includes(`Version ${versionName(base + 3)} is available`), "next release offered");
  await until(async () => (await cdp.action())?.includes("Download update"), "next release needs its own download");
  await screenshot("08-next-release-download");
  console.log("PASS the next release after an installed update offers a new download");
} finally {
  cdp?.close();
  await new Promise((done) => server.close(done));
}
