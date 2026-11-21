import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";
import { waitFor } from "./e2e/wait.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PI_TEST_PLAYWRIGHT || "playwright");
const root = repositoryRoot();
const artifacts = join(root, ".artifacts");
mkdirSync(artifacts, { recursive: true });
const scratch = mkdtempSync(join(artifacts, "composer-screenshot-"));
const requests = [];
const server = createServer(async (request, response) => {
  if (request.method === "GET") {
    response.setHeader("content-type", "application/json");
    return response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }));
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push(body);
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const [delta, finish_reason] of [[{ role: "assistant", content: "Selected message for screenshot acceptance." }, null], [{}, "stop"]]) {
    response.write("data: " + JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
  }
  response.end("data: [DONE]\n\n");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const host = new Host(resolveHostBinary(), join(scratch, "data"), { quiet: true });
let browser, child, closed, page;
let log = "";
try {
  await host.start();
  const { provider } = await host.call("providers.create", {
    name: "Local screenshot fixture", vendorKey: "custom", type: "openai_compatible",
    protocol: "openai_compatible", baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    authKind: "none", defaultModelId: "fixture", apiStyle: "chat_completions",
    models: [{ id: "fixture", contextWindow: 128000, maxTokens: 8192, supportsImages: true, thinkingLevels: ["off"], defaultThinkingLevel: "off" }],
  });
  await host.call("settings.set", {
    language: "en", theme: "dark", mirrorCodingWelcomeCompleted: true,
    onboardingDismissed: true, autoGenerateTitle: false,
    defaultProviderId: provider.id, defaultModelId: "fixture", defaultMode: "agent",
  });
  await host.stop();
  const appDir = resolve(process.argv.find(arg => arg.startsWith("--app-dir="))?.slice(10) || join(root, "apps/desktop"));
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(scratch, "data"), PI_DESKTOP_START_MAXIMIZED: "0", ELECTRON_RENDERER_URL: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  const port = Number(process.env.PI_SCREENSHOT_CDP_PORT || 9493);
  child = spawn(resolveElectronBinary(root).electronBinary, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(scratch, "profile")}`, "."], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  closed = once(child, "close");
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log += data; });
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error("Isolated Desktop exited: " + log);
    try { return (await fetch(`http://127.0.0.1:${port}/json/list`)).ok; } catch { return false; }
  }, 60000, "isolated Desktop debugger");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page = context.pages().find(page => page.url().includes("index.html") && !page.url().includes("surface=")) || await context.waitForEvent("page");
  page.setDefaultTimeout(45000);
  const invoke = (key, ...args) => page.evaluate(async ({ key, args }) => {
    const result = await window.piDesktop.invoke(window.piDesktop.channels.invoke[key], ...args);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.data;
  }, { key, args });
  await page.locator('.composer-input[contenteditable="true"]').waitFor({ timeout: 60000 });
  const guide = page.locator('[data-surface="startup-guide"]');
  await guide.waitFor();
  await guide.getByRole("button", { name: "Skip", exact: true }).first().click();
  await guide.waitFor({ state: "hidden" });
  const images = () => {
    const path = join(scratch, "data", "scratch");
    return existsSync(path) ? readdirSync(path, { recursive: true }).filter(name => name.endsWith(".png")).map(name => join(path, name)) : [];
  };
  const overlays = () => context.pages().filter(page => page.url().includes("screenshot.html"));
  async function openCapture(button) {
    if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "scripts/e2e/show-fixture-window.ps1"), "-targetProcessId", String(child.pid)]);
    await page.bringToFront();
    await button.click();
    let overlay;
    await waitFor(async () => {
      for (const candidate of overlays()) {
        if (await candidate.evaluate(() => document.hasFocus() && !!document.querySelector("img")?.naturalWidth)) { overlay = candidate; return true; }
      }
      return false;
    }, 15000, "focused screen selection overlay");
    assert.equal(await overlay.evaluate(() => typeof window.piDesktop), "undefined", "capture overlay exposes no general application bridge");
    return overlay;
  }
  const editor = page.locator('.composer-dock .composer-input[contenteditable="true"]').first();
  await editor.fill("Initial screenshot context");
  if (!process.argv.includes("--context-menu-only")) {
    await invoke("windowControl", { action: "toggleMaximize" });
    await waitFor(async () => (await invoke("windowControl", { action: "getState" })).maximized, 5000, "maximized fixture window");
    const button = page.locator(".composer-dock").first().getByRole("button", { name: "[Screenshot]", exact: true });
    const beforeHome = (await invoke("sessionList")).sessions.length;
    assert.equal(beforeHome, 0);
    let overlay = await openCapture(button);
    await overlay.keyboard.down("Escape");
    await waitFor(() => overlays().length === 0, 5000, "home capture cancellation");
    await page.keyboard.up("Escape");
    assert.equal((await invoke("sessionList")).sessions.length, beforeHome, "cancelling on Home creates no session");
    overlay = await openCapture(button);
    await overlay.mouse.move(300, 180); await overlay.mouse.down();
    await overlay.mouse.move(500, 300); await overlay.mouse.up();
    await editor.locator('.composer-chip[data-image]').waitFor();
    assert.equal((await invoke("sessionList")).sessions.length, beforeHome + 1, "accepted Home screenshot gets a durable owner");
    assert.equal(images().length, 1);
    assert.equal(requests.length, 0);
    console.log("PASS Home screenshot cancellation and attachment without sending");
  }
  await editor.press("Enter");
  const message = page.locator('.assistant-turn [data-quote-body] p').filter({ hasText: "Selected message" }).last();
  await message.waitFor();
  async function selectMessage() {
    await page.waitForFunction(() => [...document.querySelectorAll(".thread-wrap")].filter(element => element.getClientRects().length).every(element => element.dataset.transcriptSettling !== "true"));
    await message.scrollIntoViewIfNeeded();
    await message.click();
    await message.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selected = window.getSelection();
      selected.removeAllRanges();
      selected.addRange(range);
    });
    await page.locator(".selection-actions").waitFor();
  }
  await selectMessage();
  const selected = await page.evaluate(() => window.getSelection().toString());
  await message.click({ button: "right" });
  await page.getByRole("menu").waitFor();
  await page.locator(".selection-actions").waitFor({ state: "hidden", timeout: 3000 });
  assert.equal(await page.evaluate(() => window.getSelection().toString()), selected);
  await page.screenshot({ path: join(scratch, "context-menu.png") });
  await page.evaluate(() => {
    document.dispatchEvent(new Event("selectionchange"));
    window.dispatchEvent(new Event("resize"));
    document.querySelector(".chat-scroll")?.dispatchEvent(new Event("scroll"));
  });
  assert.equal(await page.locator(".selection-actions").count(), 0, "the old selection stays suppressed while its context menu is open");
  await page.keyboard.press("Escape");
  await message.click();
  await selectMessage();
  await page.locator(".selection-actions button").first().click();
  await page.locator('.composer-dock [data-message-quotes]').waitFor();
  console.log("PASS selection -> context menu only -> new selection -> add quote");
  if (!process.argv.includes("--context-menu-only")) {
    const screenshotButton = page.locator(".composer-dock").getByRole("button", { name: "[Screenshot]", exact: true });
    const requestCount = requests.length;
    const existingImages = images();
    await editor.fill("Keep this screenshot draft");
    let overlay = await openCapture(screenshotButton);
    assert.equal(await invoke("composerScreenshot"), null, "duplicate capture does not open another selector");
    await overlay.keyboard.down("Escape");
    await waitFor(() => overlays().length === 0, 5000, "cancelled screen windows closed");
    await page.keyboard.up("Escape");
    assert.equal(images().length, existingImages.length);
    assert.match(await editor.innerText(), /Keep this screenshot draft/);
    assert.equal(requests.length, requestCount, "cancellation never sends a message");
    await page.evaluate(() => {
      const marker = document.createElement("div");
      marker.dataset.captureFixture = "";
      marker.style.cssText = "position:fixed;left:40vw;top:30vh;width:48px;height:48px;z-index:2147483647;background:rgb(239,23,191);pointer-events:none";
      document.body.append(marker);
    });
    overlay = await openCapture(screenshotButton);
    const frame = await overlay.locator("img").evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }));
    // Select a region inside the maximized fixture, never an unrelated desktop window.
    const area = { x: Math.round(frame.viewportWidth * 0.3), y: Math.round(frame.viewportHeight * 0.2), width: Math.round(frame.viewportWidth * 0.35), height: Math.round(frame.viewportHeight * 0.25) };
    const expected = await overlay.locator("img").evaluate((image, area) => {
      const x = Math.round(area.x / window.innerWidth * image.naturalWidth);
      const y = Math.round(area.y / window.innerHeight * image.naturalHeight);
      const width = Math.round((area.x + area.width) / window.innerWidth * image.naturalWidth) - x;
      const height = Math.round((area.y + area.height) / window.innerHeight * image.naturalHeight) - y;
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      let markerPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (Math.abs(pixels[index] - 239) < 5 && Math.abs(pixels[index + 1] - 23) < 5 && Math.abs(pixels[index + 2] - 191) < 5) markerPixels++;
      }
      const samples = [0.1, 0.5, 0.9].flatMap(px => [0.1, 0.5, 0.9].map(py => [...ctx.getImageData(Math.floor(px * width), Math.floor(py * height), 1, 1).data]));
      return { width, height, samples, markerPixels };
    }, area);
    assert.ok(expected.markerPixels > 100, "native capture includes the visible fixture window, not only wallpaper");
    await overlay.mouse.move(area.x + area.width, area.y + area.height);
    await overlay.mouse.down();
    await overlay.mouse.move(area.x, area.y, { steps: 4 });
    await overlay.locator(".screenshot-region").waitFor();
    // Retain only the selected fixture region, not a full desktop screenshot.
    await overlay.screenshot({ path: join(scratch, "region-selector.png"), clip: area });
    await overlay.mouse.up();
    await page.evaluate(() => document.querySelector("[data-capture-fixture]")?.remove());
    await waitFor(() => overlays().length === 0 && images().length === existingImages.length + 1, 10000, "cropped screenshot imported");
    await editor.locator(".composer-chip[data-image]").waitFor();
    assert.match(await editor.innerText(), /Keep this screenshot draft/);
    assert.equal(requests.length, requestCount, "capture adds an attachment without sending");
    await page.locator('.composer-dock [data-message-quotes]').waitFor();
    const file = await editor.locator(".composer-chip[data-image]").getAttribute("title");
    const png = readFileSync(file);
    assert.equal(png.readUInt32BE(16), expected.width);
    assert.equal(png.readUInt32BE(20), expected.height);
    const samples = await page.evaluate(async dataUrl => {
      const image = new Image(); image.src = dataUrl; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
      return [0.1, 0.5, 0.9].flatMap(px => [0.1, 0.5, 0.9].map(py => [...ctx.getImageData(Math.floor(px * canvas.width), Math.floor(py * canvas.height), 1, 1).data]));
    }, "data:image/png;base64," + png.toString("base64"));
    assert.deepEqual(samples, expected.samples, "attachment pixels match the chosen desktop region");
    await page.screenshot({ path: join(scratch, "screenshot-attached.png") });
    await editor.press("Enter");
    await waitFor(() => requests.length > requestCount, 15000, "explicit screenshot send reaches local provider");
    assert.ok(JSON.stringify(requests.at(-1).messages).includes("Keep this screenshot draft"));
    assert.ok(requests.at(-1).messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url" && part.image_url.url.startsWith("data:image/png;base64,"))), "the vision model receives the screenshot image, not only its path");
    console.log("PASS screenshot -> Esc cancel -> reverse-drag crop -> preserved draft/quote -> explicit send");
    await page.waitForFunction(() => !document.querySelector(".composer-dock .stop-btn"));
    await selectMessage();
    await page.locator(".selection-actions button").last().click();
    const side = page.locator(".side-chat-pane");
    const sideEditor = side.locator('.composer-input[contenteditable="true"]');
    await sideEditor.fill("Side screenshot draft");
    overlay = await openCapture(side.getByRole("button", { name: "[Screenshot]", exact: true }));
    await overlay.mouse.move(180, 180); await overlay.mouse.down();
    await overlay.mouse.move(380, 320); await overlay.mouse.up();
    await sideEditor.locator(".composer-chip[data-image]").waitFor();
    assert.match(await sideEditor.innerText(), /Side screenshot draft/);
    assert.equal(await editor.locator(".composer-chip[data-image]").count(), 0, "side capture does not contaminate the main draft");
    assert.equal(new Set(images().map(path => resolve(path, "../.."))).size, 2, "main and side captures use their own session scratch");
    await page.screenshot({ path: join(scratch, "side-screenshot-attached.png") });
    overlay = await openCapture(side.getByRole("button", { name: "[Screenshot]", exact: true }));
    await overlay.mouse.click(100, 100, { button: "right" });
    await waitFor(() => overlays().length === 0, 5000, "right-click cancels screen selection");
    assert.equal(images().length, existingImages.length + 2);
    console.log("PASS side-chat screenshot isolation and right-click cancellation");
    await invoke("windowControl", { action: "toggleMaximize" });
    await waitFor(async () => !(await invoke("windowControl", { action: "getState" })).maximized, 5000, "restored fixture window");
    const layout = await side.locator(".composer-toolbar").evaluate(toolbar => {
      const outer = toolbar.getBoundingClientRect();
      const controls = [...toolbar.querySelectorAll("button")].map(button => ({ label: button.getAttribute("aria-label"), rect: button.getBoundingClientRect() })).filter(entry => entry.rect.width && entry.rect.height);
      return {
        width: outer.width,
        clipped: controls.filter(({ rect }) => rect.left < outer.left - 1 || rect.right > outer.right + 1).map(entry => entry.label),
        overlaps: controls.flatMap((entry, index) => controls.slice(index + 1).filter(other => Math.min(entry.rect.right, other.rect.right) - Math.max(entry.rect.left, other.rect.left) > 1 && Math.min(entry.rect.bottom, other.rect.bottom) - Math.max(entry.rect.top, other.rect.top) > 1).map(other => [entry.label, other.label])),
      };
    });
    assert.deepEqual(layout.clipped, [], "narrow side toolbar controls stay inside the composer");
    assert.deepEqual(layout.overlaps, [], "camera action does not overlap neighboring controls");
    await page.screenshot({ path: join(scratch, "narrow-side-toolbar.png") });
    console.log("PASS narrow side toolbar", layout.width);
    const finalRequests = requests.length;
    overlay = await openCapture(side.getByRole("button", { name: "[Screenshot]", exact: true }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitFor(() => overlays().length === 0, 5000, "owner reload closes all screen selectors");
    await page.locator('.composer-input[contenteditable="true"]').first().waitFor();
    assert.equal(images().length, 3);
    assert.equal(requests.length, finalRequests);
    console.log("PASS owner reload closes selectors without adding or sending");
  }
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(scratch, "failure.png") }).catch(() => {});
    writeFileSync(join(scratch, "failure.txt"), await page.locator("body").innerText());
  }
  throw error;
} finally {
  await browser?.close();
  if (child?.exitCode === null) child.kill();
  await closed;
  await host.stop();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  writeFileSync(join(scratch, "result.json"), JSON.stringify({ requests: requests.length }));
  writeFileSync(join(scratch, "desktop.log"), log);
  console.log("EVIDENCE " + scratch);
}
