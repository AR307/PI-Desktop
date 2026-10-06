import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, ".artifacts/mobile-update-qa");
const apk = resolve(output, "update.apk");
if (!process.env.ANDROID_HOME) throw new Error("ANDROID_HOME is required");
const adbPath = resolve(process.env.ANDROID_HOME, "platform-tools/adb.exe");
const serial = process.env.PI_ANDROID_SERIAL ?? "emulator-5554";
const appId = process.env.PI_ANDROID_UPDATE_APP_ID ?? "xyz.mirrorcoding.pi.mobile.updateqa";
const port = 38479;
const adb = async (...args) => (await run(adbPath, ["-s", serial, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  await writeFile(resolve(output, `${name}.png`), stdout);
}

const apkBytes = await readFile(apk);
let apkRequests = 0;
const server = createServer(async (request, response) => {
  if (request.url === "/mobile-update.json") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ versionName: "0.16.2", versionCode: 6, minAndroidSdk: 24,
      apkUrl: `http://127.0.0.1:${port}/update.apk`, releaseNotes: "Controlled Android update acceptance" }));
  } else if (request.url === "/update.apk") {
    apkRequests++;
    response.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Length": apkBytes.length });
    for (let offset = 0; offset < apkBytes.length && !response.destroyed; offset += 64 * 1024) {
      response.write(apkBytes.subarray(offset, offset + 64 * 1024));
      await pause(40);
    }
    response.end();
  } else { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }
  async tap(selector) {
    const rect = await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    assert(rect, `Missing control ${selector}`);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }
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
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const cdp = new Cdp(socket);
  await cdp.send("Runtime.enable");
  return cdp;
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

let cdp;
try {
  await mkdir(output, { recursive: true });
  await adb("reverse", `tcp:${port}`, `tcp:${port}`);
  await adb("shell", "am", "start", "-n", `${appId}/xyz.mirrorcoding.pi.mobile.MainActivity`);
  cdp = await until(async () => connectWebview().catch(() => null), "QA WebView");
  await until(() => cdp.evaluate("Boolean(document.querySelector('.mobile-shell'))"), "mobile shell");
  await cdp.tap("button[aria-label='Account and appearance']");
  await until(() => cdp.evaluate("document.querySelector('.mobile-update-section')?.textContent?.includes('Version 0.16.2')"), "available update");
  await screenshot("01-update-available");
  console.log("PASS update shown while signed out");

  const alreadyDownloaded = await cdp.evaluate("document.querySelector('.update-actions button')?.textContent?.includes('Install')");
  if (!alreadyDownloaded) {
    await cdp.tap(".update-actions button");
    await until(() => cdp.evaluate("document.querySelector('.update-progress progress')?.value > 0"), "download progress");
    await screenshot("02-download-progress");
    await cdp.tap(".update-actions button");
    await until(() => cdp.evaluate("!document.querySelector('.update-progress')"), "cancelled download");
    console.log("PASS progress and cancel");

    await cdp.tap(".update-actions button");
    await until(() => cdp.evaluate("Boolean(document.querySelector('.update-progress'))"), "retried download");
  } else console.log("SKIP repeat download: prior QA DownloadManager job is already complete");
  await adb("shell", "am", "force-stop", appId);
  cdp.close();
  await adb("shell", "am", "start", "-n", `${appId}/xyz.mirrorcoding.pi.mobile.MainActivity`);
  cdp = await until(async () => connectWebview().catch(() => null), "restarted QA WebView");
  await until(() => cdp.evaluate("Boolean(document.querySelector('.mobile-shell'))"), "restarted mobile shell");
  await cdp.tap("button[aria-label='Account and appearance']");
  await until(() => cdp.evaluate("document.querySelector('.update-actions button')?.textContent?.includes('Install')"), "download persisted", 60_000);
  await screenshot("03-restart-download-complete");
  if (!alreadyDownloaded) assert(apkRequests >= 2, "APK was fetched again after cancellation");
  console.log("PASS retry and restart recover DownloadManager job");

  await cdp.tap(".update-actions button");
  const nativeStep = await until(async () => {
    const nodes = await nativeNodes();
    if (nodes.some((node) => node.includes('text="Allow from this source"'))) return "permission";
    if (nodes.some((node) => node.includes('text="Update"') || node.includes('text="Install"'))) return "installer";
    return null;
  }, "Android permission or installer");
  if (nativeStep === "permission") {
    await screenshot("04-unknown-source-settings");
    await tapNative((node) => node.includes('text="Allow from this source"'));
    await adb("shell", "input", "keyevent", "4");
  }
  await until(async () => (await nativeNodes()).some((node) => node.includes('text="Update"') || node.includes('text="Install"')), "system installer");
  await screenshot("05-system-installer");
  await tapNative((node) => node.includes('text="Update"') || node.includes('text="Install"'));
  await until(async () => (await adb("shell", "dumpsys", "package", appId)).includes("versionCode=6"), "updated APK installed", 60_000);
  console.log("PASS system installer upgraded independent QA app to code 6");
} finally {
  cdp?.close();
  await new Promise((resolve) => server.close(resolve));
}
