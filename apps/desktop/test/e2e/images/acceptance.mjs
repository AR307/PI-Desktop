import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { imageFixture } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `images-${Date.now()}`));
await mkdir(output, { recursive: true });
const fixture = await imageFixture();
const passed = [], errors = [], shutdownErrors = [];
let closing = false;
let desktop, page, sessionId, imageProvider, chatProvider;
const check = (label, result = true) => { assert(result, label); passed.push(label); console.log(`PASS ${label}`); };
const until = async (probe, label, timeout = 25_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
async function open() {
  closing = false;
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "profile"), PI_DESKTOP_HOST_BIN: join(root, "target/debug/pi-desktop-host-core.exe"), PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop")], env, timeout: 60_000 });
  page = await until(async () => { for (const p of desktop.windows()) if (await p.locator(".app-shell").count()) return p; }, "desktop window", 60_000);
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => (closing ? shutdownErrors : errors).push({ message: error.message, after: passed.at(-1) }));
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await desktop.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__authUrl = url; }; });
}
async function close() { if (desktop) { closing = true; await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; }); await desktop.close(); desktop = undefined; } }
async function mode(name) {
  await page.getByRole("button", { name: /选择任务模式|Choose task mode/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await until(() => page.locator(".composer-mode-switch").textContent().then((text) => text.includes(name)), "mode selection");
}
async function choose(model, group = "中文 分组") {
  await page.locator(".composer-model-thinking-chip").click();
  await page.locator(".composer-menu-entry").first().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${model}`) }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${group}`) }).click();
  await until(() => page.locator(".composer-model-thinking-chip").textContent().then((text) => text.includes(model) && text.includes(group)), "image selection");
  await page.keyboard.press("Escape");
}
async function image(prompt) {
  const count = fixture.calls.length;
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill(prompt); await editor.press("Enter");
  await until(() => fixture.calls.length > count, "image request");
  await until(async () => (await invoke("image/jobs")).length === 0, "image task completion");
  sessionId ??= (await invoke("session/list")).sessions.find((session) => session.title !== "").id;
  await until(async () => (await invoke("session/get", { id: sessionId })).session.messages.some((message) => message.imageGeneration?.prompt === prompt), "persisted image result");
  return fixture.calls.slice(count);
}
async function screenshot(name, width, height) {
  const collapsed = await page.locator(".app-shell.sidebar-collapsed").count() > 0;
  if (!name.startsWith("preview") && ((width < 760 && !collapsed) || (width >= 760 && collapsed))) await page.locator('[data-nav="toggle-sidebar"]:visible, .ct-lead[aria-hidden="false"] button').first().click();
  const win = await desktop.browserWindow(page);
  await win.evaluate((window, size) => { window.setMinimumSize(480, 480); window.setContentSize(size.width, size.height); }, { width, height });
  await page.waitForFunction((w) => innerWidth === w, width);
  if (!name.startsWith("preview")) {
    await page.waitForFunction((collapsed) => document.querySelector(".app-shell")?.classList.contains("sidebar-collapsed") === collapsed, width < 760);
    while (await page.locator(".toast-dismiss").count()) await page.locator(".toast-dismiss").first().click();
    await page.locator(".transcript-skeleton-line").first().waitFor({ state: "hidden" });
    await page.locator(".image-result-thumbnail img").last().waitFor();
  }
  await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity));
  await page.screenshot({ path: join(output, `${name}.png`) });
  check(`${name}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
try {
  await open();
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  const auth = await until(() => desktop.evaluate(() => globalThis.__authUrl), "authorization URL");
  await fetch(auth);
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "authorized image catalog");
  const providers = (await invoke("providers/list")).providers;
  imageProvider = providers.find((p) => p.mirrorCoding?.groupId === "中文 分组"); chatProvider = imageProvider;
  check("catalog contains image capabilities and excludes pure video", !!imageProvider.mirrorCoding.imageModels["gpt-image-1"] && !imageProvider.models.some((m) => m.id === "video-fixture"));
  await invoke("settings/set", { ...await invoke("settings/get"), defaultProviderId: chatProvider.id, defaultModelId: "gpt-5", language: "zh-CN", theme: "dark" });
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  const back = page.locator(".settings-back"); if (await back.count()) await back.click();
  for (const expected of ["plan", "goal", "image"]) {
    await page.locator(".composer-mode-chip").click();
    await until(() => page.locator(".composer-mode-chip").getAttribute("data-mode").then((mode) => mode === expected), "mode cycle");
  }
  check("main mode button cycles through planning, goal and image");
  await page.locator(".composer-model-thinking-chip").click();
  await page.locator(".composer-menu-entry").first().click();
  check("image menu excludes chat-only and video models", await page.getByRole("menuitem", { name: /^gpt-5/ }).count() === 0 && await page.getByRole("menuitem", { name: /^video-fixture/ }).count() === 0);
  check("same image ID is deduplicated across groups", await page.getByRole("menuitem", { name: /^gpt-image-1/ }).count() === 1);
  await page.getByRole("menuitem", { name: /^gpt-image-1/ }).click();
  check("group menu shows actual multiplier and dynamic billing", (await page.getByRole("menuitemradio").allTextContents()).some((t) => t.includes("0.06×")) && (await page.getByRole("menuitemradio").allTextContents()).some((t) => t.includes("动态计费")));
  await page.keyboard.press("Escape");
  await choose("gpt-image-1");
  await page.getByLabel("质量", { exact: true }).selectOption("high");
  await page.getByLabel("尺寸", { exact: true }).selectOption("1024x1024");
  await page.getByLabel("数量", { exact: true }).fill("2");
  await until(() => page.getByLabel("数量", { exact: true }).inputValue().then((v) => v === "2"), "count saved");
  const direct = await image("Draw two soft gradient landscapes");
  check("direct generation uses selected group and declared options", direct.length === 1 && direct[0].path === "/v1/images/generations" && direct[0].body.n === 2 && direct[0].body.quality === "high" && direct[0].group === encodeURIComponent("中文 分组") && direct[0].authenticated);
  check("image requests omit chat reasoning", !Object.hasOwn(direct[0].body, "reasoning_effort") && !Object.hasOwn(direct[0].body, "reasoning"));
  await page.locator(".image-result-thumbnail img").first().waitFor();
  check("base64 and URL outputs are visible", await page.locator(".image-result-thumbnail img").count() === 2);
  check("URL downloads receive no account credential", fixture.downloads.every((call) => !call.authorization));
  await page.getByRole("button", { name: "预览图片", exact: true }).first().click();
  await page.getByRole("dialog", { name: "预览图片" }).waitFor();
  await screenshot("preview-dark-zh", 1100, 800);
  await page.keyboard.press("Escape");
  const savedPath = join(output, "saved-image.png");
  await desktop.evaluate(({ session }, path) => { session.defaultSession.once("will-download", (_event, item) => { item.setSavePath(path); }); }, savedPath);
  await page.locator(".image-result-actions a").first().click();
  await until(() => stat(savedPath).then((s) => s.size > 0).catch(() => false), "saved image");
  check("save writes a usable local image");
  await page.getByRole("button", { name: "用作参考图", exact: true }).first().click();
  await page.getByRole("button", { name: "用作参考图", exact: true }).nth(1).click();
  await choose("text-only-image-fixture");
  const deniedStart = fixture.calls.length;
  await page.locator('[contenteditable="true"]').first().fill("Unsupported reference request");
  await page.locator('[contenteditable="true"]').first().press("Enter");
  await page.getByRole("alert").filter({ hasText: "不支持参考图" }).first().waitFor();
  check("unsupported references are visibly rejected without a request", fixture.calls.length === deniedStart);
  await choose("gpt-image-1");
  const edits = await image("Edit both supplied references");
  check("GPT image with references selects edits JSON bridge", edits[0].path === "/v1/images/edits" && edits[0].body.images.length === 2 && edits[0].body.images.every((ref) => ref.image_url.startsWith("data:image/")));
  await choose("gemini-image-fixture");
  await page.getByLabel("比例", { exact: true }).selectOption("16:9");
  await page.getByRole("button", { name: "用作参考图", exact: true }).first().click();
  const gemini = await image("Gemini reference generation");
  check("Gemini references stay on generations with declared ratio", gemini[0].path === "/v1/images/generations" && gemini[0].body.images.length === 1 && gemini[0].body.aspect_ratio === "16:9" && !gemini[0].body.quality && !gemini[0].body.size);
  await choose("seedream-fixture");
  await page.getByRole("button", { name: "用作参考图", exact: true }).first().click();
  const seedream = await image("Seedream reference generation");
  check("Seedream uses normalized JSON references", seedream[0].path === "/v1/images/generations" && seedream[0].body.images.length === 1 && !seedream[0].body.aspect_ratio);
  await choose("gpt-image-1");
  await mode("智能体");
  await page.locator(".composer-model-thinking-chip").click();
  await page.locator(".composer-menu-entry").first().click();
  check("chat menu excludes pure image models and retains dual-capability models", await page.getByRole("menuitem", { name: /^gpt-image-1/ }).count() === 0 && await page.getByRole("menuitem", { name: /^gemini-image-fixture/ }).count() === 1);
  await page.keyboard.press("Escape");
  check("chat selection remains gpt-5", (await page.locator(".composer-model-thinking-chip").textContent()).includes("gpt-5"));
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("tool-image: choose a suitable image model and group yourself"); await editor.press("Enter");
  await page.getByText("Agent image is ready. Manual image selection was kept.", { exact: true }).waitFor({ timeout: 45_000 });
  check("chat agent lists models, independently chooses and displays generated image", fixture.calls.at(-1).body.model === "seedream-fixture" && await page.locator(".tool-row .image-result-thumbnail").count() > 0);
  const session = (await invoke("session/get", { id: sessionId })).session;
  check("chat reasoning still reaches its chat adapter", fixture.chats.some((call) => call.reasoning_effort === "medium"));
  check("agent tool result persists without inline image binaries", session.messages.some((m) => m.toolName === "GenerateImage") && !JSON.stringify(session).includes(fixture.bytes.toString("base64")));
  await mode("图片生成");
  check("agent choice leaves manual image selection intact", (await page.locator(".composer-model-thinking-chip").textContent()).includes("gpt-image-1"));
  fixture.control.downloadsFail = true;
  await image("URL image for download retry");
  const callCount = fixture.calls.length;
  fixture.control.downloadsFail = false;
  await page.getByRole("button", { name: "重试下载", exact: true }).click();
  await until(() => page.getByRole("button", { name: "重试下载", exact: true }).count().then((count) => count === 0), "retry download");
  check("download retry does not regenerate", fixture.calls.length === callCount);
  fixture.control.downloadsHold = true;
  const downloadStart = fixture.downloads.length;
  await editor.fill("URL image stopped during download"); await editor.press("Enter");
  await until(() => fixture.downloads.length > downloadStart, "image download in progress");
  await page.locator(".stop-btn").click();
  await until(async () => (await invoke("image/jobs")).length === 0, "stopped image download");
  const stoppedDownload = (await invoke("session/get", { id: sessionId })).session.messages.find((message) => message.imageGeneration?.prompt === "URL image stopped during download");
  check("Stop during download records cancellation and preserves prompt", stoppedDownload?.status === "aborted" && (await editor.textContent()).includes("URL image stopped during download"));
  fixture.control.downloadsHold = false;
  const beforeDownloadRetry = fixture.calls.length;
  await page.getByRole("button", { name: "重试下载", exact: true }).click();
  await until(() => page.getByRole("button", { name: "重试下载", exact: true }).count().then((count) => count === 0), "stopped download retry");
  check("stopped download can resume without generating again", fixture.calls.length === beforeDownloadRetry);
  fixture.control.hold = true;
  await editor.fill("Slow image to stop"); await editor.press("Enter");
  await until(async () => (await invoke("image/jobs")).length === 1, "running image");
  await page.locator(".stop-btn").click();
  await until(async () => (await invoke("image/jobs")).length === 0, "cancelled image");
  check("Stop cancels image task and keeps prompt", (await editor.textContent()).includes("Slow image to stop"));
  fixture.control.hold = false;
  for (const status of [429, 503]) {
    fixture.control.imageStatus = status;
    const before = fixture.calls.length;
    await image(`Controlled failure ${status}`);
    check(`${status} remains signed in and is not replayed`, fixture.calls.length === before + 1 && (await invoke("mirrorcoding/getState")).status === "connected");
  }
  fixture.control.imageStatus = 200; fixture.control.rejectOnce = true;
  await image("Refresh auth once");
  check("401 refreshes once before image output", fixture.control.refreshes === 1);
  await screenshot("image-dark-zh-narrow", 600, 700);
  await invoke("settings/set", { ...await invoke("settings/get"), language: "en", theme: "light" });
  await close(); await open();
  if (await page.locator(".app-shell.sidebar-collapsed").count()) await page.locator('[data-nav="toggle-sidebar"]:visible, .ct-lead[aria-hidden="false"] button').first().click();
  const restored = (await invoke("session/get", { id: sessionId })).session;
  check("restart retains image results and chat model", restored.messages.some((m) => m.imageGeneration?.images.some((i) => i.attachment)) && restored.modelId === "gpt-5");
  // Select the persisted task through its sidebar row.
  await page.getByText(restored.title, { exact: true }).first().click();
  await page.locator(".image-result-thumbnail img").first().waitFor();
  check("restart renders saved images", await page.locator(".image-result-thumbnail img").count() > 0);
  await screenshot("image-light-en-narrow", 600, 700);
  await screenshot("image-light-en", 1200, 800);
  await page.getByRole("button", { name: "Choose task mode" }).click();
  await page.getByRole("menuitemradio").first().focus(); await page.keyboard.press("ArrowDown");
  check("mode menu supports keyboard focus", await page.getByRole("menuitemradio").nth(1).evaluate((el) => el === document.activeElement));
  await page.keyboard.press("Escape");
  check("Esc closes mode menu without changing selection", await page.getByRole("menuitemradio").count() === 0 && (await page.locator(".composer-mode-switch").textContent()).includes("Image generation"));
  for (const planningMode of ["plan", "goal"]) {
    const planning = (await invoke("session/create", { title: `Image catalog in ${planningMode}`, mode: planningMode, providerId: chatProvider.id, modelId: "gpt-5", thinkingLevel: "medium" })).session;
    const chatStart = fixture.chats.length;
    await invoke("agent/prompt", { sessionId: planning.id, content: "Inspect the available image options before executing." });
    await until(() => fixture.chats.length > chatStart, "planning model request");
    const names = fixture.chats[chatStart].tools.map((tool) => tool.function.name);
    check(`${planningMode} permits image directory but not generation`, names.includes("ListImageModels") && !names.includes("GenerateImage"));
    await invoke("agent/abort", { sessionId: planning.id });
  }
  const regular = (await invoke("providers/create", { name: "Image QA ordinary chat", vendorKey: "custom", type: "custom", authKind: "none", baseUrl: `${fixture.origin}/v1`, apiStyle: "chat_completions", models: [{ id: "ordinary-chat", contextWindow: 128000, maxTokens: 4096, thinkingLevels: [], defaultThinkingLevel: "off" }] })).provider;
  const ordinary = (await invoke("session/create", { title: "Ordinary provider image tools", mode: "agent", providerId: regular.id, modelId: "ordinary-chat", thinkingLevel: "off" })).session;
  fixture.control.hold = true;
  const heldStart = fixture.calls.length, beforeToolAbort = fixture.control.aborted;
  await invoke("agent/prompt", { sessionId: ordinary.id, content: "tool-image: generate an image, then stop." });
  await until(() => fixture.calls.length > heldStart, "agent image tool awaiting output");
  await invoke("agent/abort", { sessionId: ordinary.id });
  await until(async () => !(await invoke("agent/getStatus", ordinary.id)).status?.isRunning, "agent image cancellation");
  await until(() => fixture.control.aborted > beforeToolAbort, "image tool upstream disconnect");
  check("Stop cancels image generation inside a chat tool");
  fixture.control.hold = false;
  fixture.control.offline = true;
  await invoke("mirrorcoding/refresh");
  check("catalog network failure retains synchronized image models", (await invoke("image/models")).length > 0);
  fixture.control.offline = false;
  await choose("gpt-image-1", "auto");
  const automatic = await image("Auto group request");
  check("explicit auto group uses its own binding", automatic[0].group === "auto" && !automatic[0].body.size && !automatic[0].body.quality);
  const autoSelection = (await invoke("settings/get")).imageSessions[sessionId];
  fixture.control.imageStatus = 403;
  await image("Removed auto group permission");
  await until(async () => !(await invoke("image/models")).some((model) => model.providerId === autoSelection.providerId), "permission catalog refresh");
  check("group permission changes refresh choices without changing selection", (await invoke("settings/get")).imageSessions[sessionId].providerId === autoSelection.providerId);
  fixture.control.imageStatus = 200;
  await choose("gpt-image-1");
  fixture.control.hold = true;
  await page.locator('[contenteditable="true"]').first().fill("Logout cancels this image");
  await page.locator('[contenteditable="true"]').first().press("Enter");
  await until(async () => (await invoke("image/jobs")).length === 1, "logout image in progress");
  check("logout requires confirmation while image task runs", (await invoke("mirrorcoding/logout")).confirmationRequired === true);
  await invoke("mirrorcoding/logout", true);
  await until(async () => (await invoke("image/jobs")).length === 0, "logout cancellation");
  check("confirmed logout cancels images and revokes grant", fixture.control.revocations > 0 && (await invoke("mirrorcoding/getState")).status === "signed_out");
  fixture.control.hold = false;
  const ordinaryStart = fixture.chats.length;
  await invoke("agent/prompt", { sessionId: ordinary.id, content: "Ordinary chat still works after account sign-out." });
  await until(() => fixture.chats.slice(ordinaryStart).some((call) => call.model === "ordinary-chat"), "ordinary provider after logout");
  check("ordinary provider remains usable after MirrorCoding logout");
  await invoke("mirrorcoding/login");
  const relogin = await until(() => desktop.evaluate(() => globalThis.__authUrl), "reauthorization URL"); await fetch(relogin);
  await until(async () => (await invoke("mirrorcoding/getState")).status === "connected", "reauthorized");
  fixture.control.empty = true; await invoke("mirrorcoding/refresh");
  check("successful empty catalog removes image choices", (await invoke("image/models")).length === 0);
  check("renderer has no uncaught errors", errors.length === 0);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (page && !page.isClosed()) { await page.screenshot({ path: join(output, "failure.png") }).catch(() => {}); await writeFile(join(output, "page.txt"), await page.locator("body").innerText()); }
} finally {
  await close().catch(() => {});
  await writeFile(join(output, "report.json"), JSON.stringify({ passed, errors, shutdownErrors, requests: fixture.calls.map((call) => ({ ...call, body: { ...call.body, images: call.body.images?.map(() => "reference") } })), chatCount: fixture.chats.length }, null, 2));
  fixture.close(); console.log(`Artifacts: ${output}`);
}
