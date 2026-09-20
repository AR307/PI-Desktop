#!/usr/bin/env node
/** Real Electron/browser resize regression; profiles and screenshots are retained. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertDesktopBuild, resolveElectronBinary } from "./e2e/boot.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const artifacts = process.env.PI_DESKTOP_LAYOUT_ARTIFACT_DIR
  ? resolve(process.env.PI_DESKTOP_LAYOUT_ARTIFACT_DIR)
  : await mkdtemp(join(tmpdir(), "pi-browser-layout-"));
await mkdir(artifacts, { recursive: true });
const { appDir } = assertDesktopBuild();
const binary = process.env.PI_DESKTOP_ELECTRON_BIN || resolveElectronBinary().electronBinary;
const hostBinary = resolveHostBinary();
const profile = await mkdtemp(join(artifacts, "profile-"));
const connections = [];
let child;
let main;
let renderer;
let chrome;
let output = "";
const results = [];

async function waitFor(check, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out: ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    let result;
    try {
      result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    } catch (error) {
      throw new Error(`${error.message}: ${expression.slice(0, 150)}`);
    }
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  connections.push(socket);
  return { send, evaluate };
}

async function click(selector) {
  const point = await renderer.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    if (!el.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Obscured control: ' + ${JSON.stringify(selector)});
    return point;
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await renderer.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
}

async function panelWidth(width) {
  const rect = await renderer.evaluate(`document.querySelector('.work-panel-resize').getBoundingClientRect().toJSON()`);
  const current = await renderer.evaluate(`document.querySelector('.work-panel').getBoundingClientRect().width`);
  const start = { x: rect.x + rect.width / 2, y: rect.y + 100 };
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + current - width, y: start.y, button: "left", buttons: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + current - width, y: start.y, button: "left", buttons: 0, clickCount: 1 });
}

async function geometry() {
  return main.evaluate(`(async () => {
    const views = layoutWindow.contentView.children;
    const guest = views.find(v => v.webContents?.getURL().startsWith('http://127.0.0.1:'));
    const chrome = views.find(v => v.webContents?.getURL().includes('pi.browser/views/browser.html'));
    if (!guest || !chrome) return null;
    return {
      guest: guest.getBounds(), chrome: chrome.getBounds(),
      surface: await layoutWindow.webContents.executeJavaScript('document.querySelector(".work-plugin-view-surface")?.getBoundingClientRect().toJSON()'),
      viewport: await guest.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,columns:getComputedStyle(document.querySelector("main")).gridTemplateColumns.split(" ").length})')
    };
  })()`);
}

async function checkGeometry(label, width) {
  const actual = await waitFor(async () => {
    if (await renderer.evaluate(`document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)`)) return false;
    const g = await geometry();
    if (!g?.surface || (width && g.chrome.width !== width) ||
      g.chrome.width !== Math.round(g.surface.width) || g.chrome.height !== Math.round(g.surface.height)) return false;
    return g.viewport.width === g.guest.width && g.viewport.height === g.guest.height &&
      g.guest.width === g.chrome.width && g.guest.y > g.chrome.y &&
      g.guest.y + g.guest.height === g.chrome.y + g.chrome.height && g;
  }, label);
  assert.equal(actual.viewport.columns, actual.viewport.width <= 600 ? 1 : 3);
  results.push({ label, ...actual });
  console.log(`PASS ${label}: ${actual.viewport.width} x ${actual.viewport.height}`);
}

async function screenshot(label) {
  const captures = await main.evaluate(`(async () => {
    const guest = layoutWindow.contentView.children.find(v => v.webContents?.getURL().startsWith('http://127.0.0.1:'));
    return {
      shell: (await layoutWindow.capturePage()).toPNG().toString('base64'),
      page: (await guest.webContents.capturePage()).toPNG().toString('base64')
    };
  })()`);
  for (const [surface, data] of Object.entries(captures)) {
    await writeFile(join(artifacts, `${label}-${surface}.png`), Buffer.from(data, "base64"));
  }
}

const fixture = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font:20px system-ui;background:#e7edf8;color:#123}
header{padding:24px;background:#247;color:white}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px}
article{background:white;border:2px solid #49a;padding:24px}footer{height:1600px;padding:24px}
@media(max-width:600px){main{grid-template-columns:1fr}header{background:#a43}}</style>
<header><h1>Responsive browser preview</h1><output></output></header>
<main><article>One</article><article>Two</article><article>Three</article></main>
<button onclick="this.textContent='Clicked'">Verify input</button><footer>Capture and resize regression</footer>
<script>function paint(){document.querySelector('output').textContent=innerWidth+' x '+innerHeight}addEventListener('resize',paint);paint()</script></html>`;
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixture);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const host = new Host(hostBinary, join(profile, "data"));
  let sessionId;
  try {
    await host.start(12);
    const result = await host.call("session.create", { title: "Browser layout regression" });
    sessionId = result.session.id;
  } finally {
    await host.stop();
  }
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(profile, "data"),
    PI_DESKTOP_HOST_BIN: hostBinary, PI_DESKTOP_START_MAXIMIZED: "0", ELECTRON_RENDERER_URL: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(binary, ["--inspect=0", "--remote-debugging-port=0", `--user-data-dir=${join(profile, "electron")}`, appDir],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { output += String(data); });
  child.stderr.on("data", data => { output += String(data); });
  const inspector = await waitFor(() => output.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1], "main inspector");
  const browserInspector = await waitFor(() => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], "renderer inspector");
  const port = new URL(browserInspector).port;
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = await waitFor(async () => (await targets()).find(t => t.url.endsWith("/out/renderer/index.html")), "main renderer");
  main = await connect(inspector);
  await main.evaluate(`globalThis.layoutElectron = process.getBuiltinModule('module').createRequire(process.execPath)('electron'); true`);
  renderer = await connect(target.webSocketDebuggerUrl);
  await waitFor(() => renderer.evaluate(`!!document.querySelector('.main-pane') && !!window.__PI_DESKTOP__`), "ready shell");
  await waitFor(() => renderer.evaluate(`!!document.querySelector('.mirrorcoding-actions button:last-child')`), "welcome");
  await click(".mirrorcoding-actions button:last-child");
  await renderer.evaluate(`window.__PI_DESKTOP__.selectSession(${JSON.stringify(sessionId)})`);
  await main.evaluate(`globalThis.layoutWindow = layoutElectron.BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/out/renderer/index.html')); layoutWindow.setBounds({x:100,y:100,width:1400,height:900}); layoutWindow.show(); layoutWindow.setTitle('PI-Desktop Layout Test')`);
  await waitFor(() => renderer.evaluate(`document.querySelector('.app-work-panel-toggle')?.disabled === false`), "session selected");
  await click(".app-work-panel-toggle");
  await waitFor(() => renderer.evaluate(`!!document.querySelector('.work-panel')`), "work panel");
  await renderer.evaluate(`[...document.querySelectorAll('button')].find(b => ['Browser','浏览器'].includes(b.textContent)).click()`);
  const chromeTarget = await waitFor(async () => (await targets()).find(t => t.url.includes("pi.browser/views/browser.html")), "browser chrome");
  chrome = await connect(chromeTarget.webSocketDebuggerUrl);
  await waitFor(() => chrome.evaluate(`!!document.querySelector('#url') && !!window.pluginBridge`), "browser ready");
  await chrome.evaluate(`document.querySelector('#url').value='http://127.0.0.1:${server.address().port}'; document.querySelector('#form').requestSubmit()`);
  await checkGeometry("initial browser");
  await panelWidth(360);
  await checkGeometry("narrow preview", 360);
  await screenshot("narrow");
  for (let i = 0; i < 8; i += 1) {
    const width = i % 2 === 0 ? 650 : 360;
    const command = i % 3 === 0
      ? `window.pluginBridge.invoke('browser.cdp',{method:'Page.captureScreenshot',params:{captureBeyondViewport:true,clip:{x:0,y:0,width:360,height:2400,scale:1}}})`
      : `window.pluginBridge.invoke('browser.screenshot',{fullPage:true})`;
    const [shot] = await Promise.all([chrome.evaluate(`${command}.then(s=>s.data.length)`), panelWidth(width)]);
    assert.ok(shot > 100);
    await checkGeometry(`capture during resize ${i + 1}`, width);
  }
  await Promise.all([
    chrome.evaluate(`Promise.all([window.pluginBridge.invoke('browser.screenshot',{fullPage:true}),window.pluginBridge.invoke('browser.screenshot',{fullPage:true})]).then(shots=>shots.length)`),
    panelWidth(650),
  ]);
  await checkGeometry("concurrent captures", 650);
  await screenshot("wide");
  await assert.rejects(chrome.evaluate(`window.pluginBridge.invoke('browser.cdp',{method:'Page.captureScreenshot',params:{format:'invalid'}})`));
  await panelWidth(360);
  await checkGeometry("resize after failed capture", 360);
  await click(".work-panel-maximize");
  await waitFor(() => renderer.evaluate(`!!document.querySelector('.app-shell.work-panel-maximized')`), "panel maximized");
  await checkGeometry("maximized panel");
  await main.evaluate(`layoutWindow.setSize(1100,760)`);
  await waitFor(() => renderer.evaluate(`innerWidth===1100 && innerHeight===760`), "window resized");
  await checkGeometry("native window resize");
  await screenshot("resized-window");
  await click(".work-panel-maximize");
  await waitFor(() => renderer.evaluate(`!document.querySelector('.app-shell.work-panel-maximized')`), "panel restored");
  await checkGeometry("restored panel");
  await click(".app-work-panel-toggle");
  await waitFor(() => main.evaluate(`layoutWindow.contentView.children.length===0`), "hidden native views");
  await click(".app-work-panel-toggle");
  await checkGeometry("reopened panel");
  await click(".work-panel-new-tab");
  await waitFor(() => renderer.evaluate(`document.querySelectorAll('[role=tab]').length===2`), "new tab clickable");
  await click(".work-panel-tab:last-child .work-panel-tab-close");
  await waitFor(() => renderer.evaluate(`document.querySelectorAll('[role=tab]').length===1`), "tab close clickable");
  console.log(`PASS ${results.length} browser layout scenarios; native titlebar dragging is a separate OS-input check.`);
} finally {
  await writeFile(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  await writeFile(join(artifacts, "electron.log"), output);
  if (main) await main.evaluate(`setImmediate(()=>layoutElectron.app.exit(0)); true`).catch(error => console.error(error.message));
  for (const socket of connections) socket.close();
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    const timer = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timer);
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  console.log(`Artifacts retained: ${artifacts}`);
}
