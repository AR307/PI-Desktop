import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { imageFixture } from "./fixture.mjs";
import { imageChatModel } from "../../../../../scripts/e2e/image-chat-model.mjs";

// Real Agent -> image tool -> persisted transcript -> renderer. Only the
// external account/model service is simulated; never use a live account.
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `agent-image-result-${Date.now()}`));
await mkdir(output, { recursive: true });
const fixture = await imageFixture();
const configured = imageChatModel();
const configuredServer = createServer(configured.handler);
await new Promise(resolve => configuredServer.listen(0, "127.0.0.1", resolve));
const passed = [];
const errors = [];
let desktop, page, sessionId;
let closing = false;
const check = (label, value = true) => {
  assert(value, label);
  passed.push(label);
  console.log(`PASS ${label}`);
};
const until = async (probe, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
async function ready() {
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(".startup-splash").waitFor({ state: "hidden" });
}
async function open() {
  closing = false;
  const env = {
    ...process.env,
    PI_DESKTOP_DATA_DIR: join(output, "profile"),
    PI_DESKTOP_HOST_BIN: process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe"),
    PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({
    executablePath: process.env.PI_TEST_ELECTRON ?? require("electron"),
    args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`],
    env, timeout: 60_000,
  });
  page = await until(async () => desktop.windows().find(p => p.url().includes("index.html") && !p.url().includes("plugin-launcher")), "main window", 60_000);
  page.setDefaultTimeout(20_000);
  page.on("pageerror", error => { if (!closing) errors.push(error.message); });
  await ready();
}
async function close() {
  if (!desktop) return;
  closing = true;
  await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await desktop.close();
  desktop = undefined;
}
async function selectSession() {
  if (await page.locator(".app-shell.sidebar-collapsed").count()) {
    await page.locator('[data-nav="toggle-sidebar"]:visible, .ct-lead[aria-hidden="false"] button').first().click();
  }
  await page.locator(`[data-sidebar-session-row="${sessionId}"]`).first().click();
}
async function imageVisible(label) {
  await page.locator(".image-result-thumbnail img").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() => {
    const image = document.querySelector(".image-result-thumbnail img");
    return image?.complete && image.naturalWidth === 400;
  });
  check(label, await page.locator(".image-result").count() === 1
    && await page.locator(".turn-process .image-result").count() === 0);
}
async function screenshot(name, width, height, preview = ".image-result-thumbnail") {
  const win = await desktop.browserWindow(page);
  await win.evaluate((window, size) => {
    window.setMinimumSize(480, 480);
    window.setContentSize(size.width, size.height);
  }, { width, height });
  await page.waitForFunction(w => innerWidth === w, width);
  await page.locator(preview).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, `${name}.png`) });
  check(`${name}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
const revision = ref => execFileSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" }).trim();
const report = { candidate: revision("HEAD"), base: revision("origin/main"), passed, errors, output };
try {
  await open();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__authUrl = url; }; });
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  const auth = await until(() => desktop.evaluate(() => globalThis.__authUrl), "local authorization URL");
  assert.equal(new URL(auth).origin, fixture.origin);
  await fetch(auth);
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "authorized catalog");
  const provider = (await invoke("providers/list")).providers.find(p => p.mirrorCoding?.groupId === "中文 分组");
  assert(provider);
  await invoke("settings/set", { ...await invoke("settings/get"), defaultProviderId: provider.id, defaultModelId: "gpt-5", language: "zh-CN", theme: "dark" });
  await page.reload();
  await ready();
  const editor = page.locator('.composer-input[contenteditable="true"]');
  await editor.fill("tool-image: generate an image and show the result in your final reply");
  await editor.press("Enter");
  await page.getByText("Agent image is ready. Manual image selection was kept.", { exact: true }).waitFor({ timeout: 45_000 });
  await page.locator('.turn-process > [aria-expanded="false"]').waitFor();
  sessionId = (await invoke("session/list")).sessions[0].id;
  const session = (await invoke("session/get", { id: sessionId })).session;
  const tool = session.messages.find(message => message.toolName === "GenerateImage");
  check("real Agent completed GenerateImage and saved its result", tool?.toolStatus === "success" && fixture.calls.length === 1);
  await imageVisible("finished image is visible outside the automatically collapsed process");
  await screenshot("result-dark-wide", 1200, 900);

  await page.locator(".turn-process > .tool-activity-header").click();
  await page.locator('.turn-process > [aria-expanded="true"]').waitFor();
  check("first pointer click opens the automatically collapsed process");
  // Open nested activities too: an inline ToolRow must not add a second card.
  for (const button of await page.locator('.turn-process .process-activity-group > [aria-expanded="false"]').all()) await button.click();
  await imageVisible("expanding the process does not duplicate the image");
  await page.locator(".turn-process > .tool-activity-header").click();
  await imageVisible("collapsing the process keeps the image visible");
  for (const mode of ["flat", "command-first", "fully-folded"]) {
    await invoke("settings/set", { ...await invoke("settings/get"), transcriptDisplayMode: mode });
    await page.reload();
    await ready();
    await selectSession();
    await imageVisible(`${mode}: completed image stays visible exactly once`);
    await page.locator(".turn-process > .tool-activity-header").click();
    for (const button of await page.locator('.turn-process .process-activity-group > [aria-expanded="false"]').all()) await button.click();
    await imageVisible(`${mode}: expanding process does not duplicate the result`);
    await page.locator(".turn-process > .tool-activity-header").click();
  }
  await page.getByRole("button", { name: "预览图片", exact: true }).click();
  await page.getByRole("dialog", { name: "预览图片" }).waitFor();
  await page.screenshot({ path: join(output, "preview-dark.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "预览图片" }).waitFor({ state: "hidden" });
  check("image preview opens and closes with Escape");
  const savedPath = join(output, "saved-image.png");
  await desktop.evaluate(({ session }, path) => {
    session.defaultSession.once("will-download", (_event, item) => { item.setSavePath(path); });
  }, savedPath);
  await page.locator(".image-result-actions a").click();
  await until(() => stat(savedPath).then(s => s.size > 0).catch(error => {
    if (error.code === "ENOENT") return false;
    throw error;
  }), "saved image");
  check("save downloads the generated PNG", (await readFile(savedPath)).equals(fixture.bytes));
  await editor.fill("Keep this draft while adding a reference.");
  await page.getByRole("button", { name: "用作参考图", exact: true }).click();
  await editor.locator("[data-token]").waitFor();
  check("use as reference keeps the existing draft", (await editor.innerText()).includes("Keep this draft while adding a reference."));
  await page.getByRole("button", { name: "用作参考图", exact: true }).click();
  check("reusing the same image does not duplicate the reference", await editor.locator("[data-token]").count() === 1);

  await invoke("settings/set", { ...await invoke("settings/get"), theme: "light" });
  await page.reload();
  await ready();
  await selectSession();
  await imageVisible("reloading restores the image from stored tool output");
  if (!await page.locator(".app-shell.sidebar-collapsed").count()) await page.locator('[data-nav="toggle-sidebar"]').first().click();
  await screenshot("result-light-narrow", 650, 850);
  await close();
  await open();
  await selectSession();
  await imageVisible("restarting restores the same image without another generation");
  check("viewing, saving, referencing and restoring do not regenerate", fixture.calls.length === 1);

  // The separately configured GenerateImages tool is a live contract too.
  // Exercise its unchanged gallery through the same turn renderer.
  const providerInput = {
    vendorKey: "custom", type: "openai_compatible", protocol: "openai_compatible",
    baseUrl: `http://127.0.0.1:${configuredServer.address().port}/v1`,
    authKind: "none", defaultModelId: "fixture", apiStyle: "chat_completions",
  };
  const chat = (await invoke("providers/create", { ...providerInput, name: "Configured chat fixture" })).provider;
  const images = (await invoke("providers/create", { ...providerInput, name: "Configured image fixture" })).provider;
  await invoke("settings/set", {
    ...await invoke("settings/get"), defaultProviderId: chat.id, defaultModelId: "fixture",
    defaultPermissionMode: "auto", imageGeneration: { providerId: images.id, modelId: "fixture" },
  });
  sessionId = (await invoke("session/create", {
    title: "Configured image results", mode: "agent", providerId: chat.id,
    modelId: "fixture", thinkingLevel: "medium", permissionMode: "auto",
  })).session.id;
  await page.reload();
  await ready();
  await selectSession();
  const configuredEditor = page.locator('.composer-input[contenteditable="true"]');
  await configuredEditor.fill("Generate two orange spheres on a blue background.");
  await configuredEditor.press("Enter");
  await page.getByText("已生成两张图片，可在对话中查看。", { exact: true }).waitFor({ timeout: 60_000 });
  await page.locator('.turn-process > [aria-expanded="false"]').waitFor();
  await page.locator(".generated-image-preview img").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".generated-image-preview img")?.naturalWidth === 480);
  check("configured GenerateImages still displays one gallery with two results", configured.imageRequests.length === 2
    && await page.locator(".generated-images").count() === 1
    && await page.locator(".generated-image-thumbnails button").count() === 2
    && await page.locator(".turn-process .generated-images").count() === 0);
  await page.locator(".turn-process > .tool-activity-header").click();
  for (const button of await page.locator('.turn-process .process-activity-group > [aria-expanded="false"]').all()) await button.click();
  check("expanding configured image tools does not duplicate the gallery", await page.locator(".generated-images").count() === 1);
  await page.locator(".turn-process > .tool-activity-header").click();
  await screenshot("configured-result-light", 1200, 900, ".generated-image-preview");
  check("configured image provider completed without fixture errors", configured.failures.length === 0);
  check("renderer has no runtime errors", errors.length === 0);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, "failure.png") });
  process.exitCode = 1;
} finally {
  await close();
  fixture.close();
  configuredServer.closeAllConnections();
  configuredServer.close();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  // Keep the isolated profiles, screenshots and downloaded image for review.
}
