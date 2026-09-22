import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { startUpstream } from "./upstream.mjs";
import { startMirrorCoding } from "./local-service.mjs";

const require = createRequire(import.meta.url);
const { _electron, chromium } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `mirrorcoding-${Date.now()}`));
await mkdir(output, { recursive: true });
const upstream = await startUpstream();
let service, desktop, browser, page, catalog;
const passed = [];
const check = (label, value = true) => { assert(value, label); passed.push(label); console.log(`PASS ${label}`); };
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${channel}`, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}, { channel, args });
const until = async (check, label, timeout = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
async function openDesktop(profile = "profile") {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, profile), PI_DESKTOP_HOST_BIN: join(root, "target/debug/pi-desktop-host-core.exe"), PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: service.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop")], env, timeout: 60_000 });
  page = await until(async () => {
    for (const candidate of desktop.windows()) {
      if (await candidate.locator(".app-shell").count()) return candidate;
    }
    return undefined;
  }, "main Electron window", 60_000);
  page.setDefaultTimeout(20_000);
  await desktop.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__mirrorCodingTestUrl = url; }; });
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.evaluate(() => {
    window.__mirrorEvents = [];
    window.piDesktop.on("pi-desktop/agent/event/message", (event) => window.__mirrorEvents.push(event));
  });
}
async function resize(width, height) {
  const window = await desktop.browserWindow(page);
  await window.evaluate((window, size) => { window.setMinimumSize(480, 480); window.setContentSize(size.width, size.height); }, { width, height });
  await page.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, { width, height });
}
async function centeredDialog(label) {
  check(label, await page.getByRole("dialog").evaluate((dialog) => {
    const r = dialog.getBoundingClientRect();
    return Math.abs(r.x + r.width / 2 - innerWidth / 2) < 2 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 2 && r.x >= 0 && r.y >= 0;
  }));
}
async function chooseModel(model, group) {
  await page.locator(".composer-model-thinking-chip").click();
  await page.locator(".composer-menu-entry").first().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${model.replaceAll(".", "\\.")}`) }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${group}`) }).click();
  await until(() => page.locator(".composer-model-thinking-chip").getAttribute("aria-label").then((text) => text.includes(group)), "model/group chip");
  await page.locator(".composer-menu-entry").first().waitFor();
  await page.keyboard.press("Escape");
}
async function chooseThinking(level) {
  await page.locator(".composer-model-thinking-chip").click();
  await page.locator(".composer-menu-entry").nth(1).click();
  await page.getByRole("menuitemradio", { name: level, exact: true }).click();
  await page.locator(".composer-menu-entry").first().waitFor();
  await page.keyboard.press("Escape");
}
async function send(message) {
  const count = await page.evaluate(() => window.__mirrorEvents.length);
  const callStart = upstream.calls.length;
  const editor = page.locator('[contenteditable="true"], textarea').first();
  await editor.fill(message); await editor.press("Enter");
  await until(() => page.evaluate((offset) => window.__mirrorEvents.slice(offset).some((envelope) => envelope.event?.type === "agent_end" && !envelope.parentToolCallId), count), "agent turn completion", 60_000);
  return upstream.calls.slice(callStart);
}
async function closeDesktop() {
  if (!desktop) return;
  await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await desktop.close(); desktop = undefined;
}
try {
  service = await startMirrorCoding(upstream.port);
  console.log("Local MirrorCoding service started");
  await openDesktop();
  await page.getByRole("dialog", { name: /连接 MirrorCoding|Connect to MirrorCoding/ }).waitFor();
  await centeredDialog("welcome centered in standard window");
  await page.screenshot({ path: join(output, "welcome.png") });
  await resize(600, 640);
  await centeredDialog("welcome centered in narrow window");
  await page.keyboard.press("Tab");
  check("dialog contains keyboard focus", await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement)));
  await page.screenshot({ path: join(output, "welcome-narrow.png") });
  await resize(1200, 800);
  await page.getByRole("button", { name: /暂时跳过|Skip for now/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check("first launch offers login and skip");
  await closeDesktop(); await openDesktop();
  check("skip survives restart", !(await page.getByRole("dialog", { name: /连接 MirrorCoding|Connect to MirrorCoding/ }).count()));
  await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
  await page.getByRole("button", { name: /^(账号|Account)$/ }).click();
  await page.getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  const authorizeUrl = await until(() => desktop.evaluate(() => globalThis.__mirrorCodingTestUrl), "browser authorization URL");
  browser = await chromium.launch({ channel: "msedge", headless: false });
  const consent = await browser.newPage();
  await consent.goto(authorizeUrl);
  await consent.locator('input[name="username"]').fill("piqa");
  await consent.locator('input[name="password"]').fill(service.password);
  await consent.locator('form button[type="submit"]').click();
  await consent.getByRole("button", { name: /^(Authorize Pi Desktop|授权 Pi Desktop)$/ }).click();
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "catalog synchronization");
  const state = await invoke("mirrorcoding/getState");
  catalog = state.catalog;
  check("real browser authorization and catalog", state.status === "connected" && state.catalog.groups.length >= 4);
  const providers = (await invoke("providers/list")).providers.filter((provider) => provider.mirrorCoding);
  check("catalog projects managed groups", providers.length >= 4 && providers.every((provider) => provider.hasSecret));
  check("account-specific multiplier", providers.find((provider) => provider.mirrorCoding.groupId === "OpenAI").mirrorCoding.ratio === 0.06);
  check("auto has dynamic pricing", providers.find((provider) => provider.mirrorCoding.groupId === "auto").mirrorCoding.dynamicBilling);
  await page.screenshot({ path: join(output, "account-connected.png") });
  await page.getByLabel(/选择模型|Choose a model/, { exact: true }).selectOption("gpt-5");
  const selected = providers.find((provider) => provider.mirrorCoding.groupId === "中文 分组");
  await page.getByLabel(/选择分组|Choose a group/, { exact: true }).selectOption(selected.id);
  await page.getByRole("button", { name: /设为新会话默认|Use for new conversations/ }).click();
  await until(async () => (await invoke("settings/get")).defaultProviderId === selected.id, "saved default");
  check("explicit model then group default selection");
  console.log(JSON.stringify({ routes: selected.mirrorCoding.routes, reasoning: selected.models.map((m) => ({ id: m.id, levels: m.thinkingLevels })) }));
  // Continue through the actual Composer for the first model call.
  await page.keyboard.press("Escape");
  const back = page.locator(".settings-back");
  if (await back.count()) await back.click();
  else await page.getByRole("button", { name: /返回|Back/ }).first().click();
  const editor = page.locator('[contenteditable="true"], textarea').first();
  await editor.fill("Hello MirrorCoding, verify my selected group.");
  await editor.press("Enter");
  await page.getByText("MirrorCoding local reply: connection and selected group verified.", { exact: true }).first().waitFor({ timeout: 45_000 });
  check("actual Electron composer streams a response", upstream.calls.length > 0);
  check("reasoning reaches controlled upstream", upstream.calls.some((call) => call.body.reasoning?.effort));
  await page.screenshot({ path: join(output, "chat-streamed.png") });
  await until(() => page.evaluate(() => window.__mirrorEvents.some((entry) => entry.event?.type === "agent_end")), "first turn completion");
  await chooseThinking("high");
  const high = await send("Verify the high reasoning setting.");
  check("selected Responses high effort transmitted", high.some((call) => call.path === "/v1/responses" && call.body.reasoning?.effort === "high"));
  await page.locator(".composer-model-thinking-chip").click();
  await page.locator(".composer-menu-entry").first().click();
  check("MirrorCoding models deduplicated", await page.getByRole("menuitem", { name: /^gpt-5/ }).count() === 1);
  await page.getByRole("menuitem", { name: /^gpt-5/ }).click();
  check("group menu shows actual and dynamic rates", (await page.getByRole("menuitemradio").allTextContents()).some((value) => value.includes("0.06×")) && (await page.getByRole("menuitemradio").allTextContents()).some((value) => /动态计费|Dynamic billing/.test(value)));
  await page.screenshot({ path: join(output, "model-groups.png") });
  await resize(600, 640);
  check("narrow group menu keeps names, prices and details separate", await page.locator(".mirrorcoding-group-option").evaluateAll((options) => options.every((option) => {
    const name = option.querySelector("strong").getBoundingClientRect();
    const rate = option.querySelector(".mirrorcoding-group-rate").getBoundingClientRect();
    const detail = option.querySelector(".mirrorcoding-group-detail").getBoundingClientRect();
    return name.right <= rate.left && detail.top >= name.bottom && option.scrollWidth <= option.clientWidth;
  })));
  await page.screenshot({ path: join(output, "model-groups-narrow.png") });
  await page.getByRole("menuitemradio").first().focus();
  await page.keyboard.press("ArrowDown");
  check("group keyboard navigation moves focus", await page.getByRole("menuitemradio").nth(1).evaluate((option) => document.activeElement === option));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  check("closing group menu preserves selection", (await page.locator(".composer-model-thinking-chip").getAttribute("aria-label")).includes("中文 分组"));
  await resize(1200, 800);
  for (const [model, protocol, reasoning] of [
    ["claude-sonnet-4-5", "/v1/messages", (body) => body.thinking?.type === "enabled" && body.thinking.budget_tokens > 0],
    ["gemini-2.5-flash", "/v1beta/models/", (body) => body.generationConfig?.thinkingConfig?.thinkingBudget > 0],
    ["gpt-4o-mini", "/v1/chat/completions", () => true],
  ]) {
    await chooseModel(model, "OpenAI");
    if (model !== "gpt-4o-mini") await chooseThinking("medium");
    const calls = await send(`Verify native ${model} and the selected reasoning setting.`);
    check(`${model} native protocol and reasoning`, calls.some((call) => call.path.startsWith(protocol) && reasoning(call.body)));
    upstream.setMode("tool");
    const tools = await send("Read the first two lines of the local desktop package manifest, then summarize the result.");
    check(`${model} tool continuation`, tools.length >= 2 && tools.every((call) => call.path.startsWith(protocol)) && /tool_result|functionResponse|"role":"tool"/.test(JSON.stringify(tools.at(-1).body)));
    check(`${model} local tool succeeds`, await page.evaluate(() => window.__mirrorEvents.some((item) => item.event.type === "tool_end" && item.event.isError !== true)));
  }
  await chooseModel("gpt-5", "中文 分组");
  upstream.setMode("tool");
  const tools = await send("Read the first two lines of the local desktop package manifest, then summarize the result.");
  check("Responses tool continuation", tools.length >= 2 && JSON.stringify(tools.at(-1).body).includes("function_call_output"));
  upstream.setMode("delegate");
  await send("Delegate a short response to explorer using the same MirrorCoding model.");
  await until(() => page.evaluate(() => window.__mirrorEvents.some((item) => item.parentToolCallId && item.event.type === "message_end" && item.event.message.content?.includes("MirrorCoding local reply"))), "inherited subagent response");
  check("subagent uses inherited MirrorCoding model");
  for (const status of ["429", "503"]) {
    upstream.setMode(status); const retry = await send(`Recover from controlled ${status}.`);
    check(`temporary ${status} recovers before output`, retry.length >= 2 && retry.every((call) => call.body.model === "gpt-5"));
  }
  upstream.setMode("interrupt");
  const interrupted = await send("Keep my partial output when the stream is interrupted.");
  check("partial output is not replayed automatically", interrupted.length === 1);
  await page.screenshot({ path: join(output, "interrupted.png") });
  upstream.setMode("normal");
  check("user can actively continue after interruption", (await send("Continue from the partial response.")).length === 1);
  const lastSession = (await invoke("session/list")).sessions[0];
  await invoke("session/summarizeTitle", { sessionId: lastSession.id, userPrompt: "Summarize the conversation", providerId: selected.id, modelId: "gpt-5", thinkingLevel: "high" });
  check("title generation uses selected MirrorCoding route", upstream.calls.at(-1).path === "/v1/responses");
  await invoke("settings/set", { ...await invoke("settings/get"), promptEnhancementThinkingLevel: "high" });
  await invoke("prompt/enhance", { sessionId: lastSession.id, draft: "Improve this task", providerId: selected.id, modelId: "gpt-5" });
  check("prompt enhancement forwards its reasoning level", upstream.calls.at(-1).body.reasoning?.effort === "high");
  const compactStart = upstream.calls.length;
  await invoke("agent/compact", { sessionId: lastSession.id });
  check("compaction uses the selected MirrorCoding route", upstream.calls.slice(compactStart).some((call) => call.path === "/v1/responses"));
  const logs = await service.api("GET", "/api/log/self?p=1&page_size=100");
  check("real gateway records selected Chinese group", logs.items.some((log) => log.group === "中文 分组" && log.model_name === "gpt-5"));
  await closeDesktop(); await openDesktop();
  const restored = (await invoke("session/get", { id: lastSession.id })).session;
  check("restart preserves exact model and group", restored.providerId === selected.id && restored.modelId === "gpt-5");
  await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
  await page.getByRole("button", { name: /^(账号|Account)$/ }).click();
  await page.getByRole("button", { name: /重新授权|Reauthorize/, exact: true }).click();
  await page.getByRole("button", { name: /取消登录|Cancel sign-in/ }).click();
  check("cancel reauthorization retains account", (await invoke("mirrorcoding/getState")).status === "connected");
  await invoke("settings/set", { ...await invoke("settings/get"), theme: "light", language: "en" });
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await resize(720, 720);
  await page.screenshot({ path: join(output, "account-light-en-narrow.png") });
  check("English account controls visible in narrow light window", await page.getByRole("button", { name: "Refresh models", exact: true }).isVisible());
  await page.evaluate(() => {
    window.__mirrorEvents = [];
    window.piDesktop.on("pi-desktop/agent/event/message", (event) => window.__mirrorEvents.push(event));
  });
  const regular = (await invoke("providers/create", { name: "Local ordinary provider", vendorKey: "custom", type: "custom", authKind: "none", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, apiStyle: "chat_completions", models: [{ id: "gpt-4o-mini", contextWindow: 128_000, maxTokens: 8_192, thinkingLevels: [], defaultThinkingLevel: "off" }] })).provider;
  const regularSession = (await invoke("session/create", { title: "Ordinary provider", mode: "agent", providerId: regular.id, modelId: "gpt-4o-mini", thinkingLevel: "off" })).session;
  upstream.setMode("hold"); const holdingStart = upstream.calls.length;
  await invoke("agent/prompt", { sessionId: lastSession.id, content: "Hold this MirrorCoding request until stopped." });
  await invoke("agent/prompt", { sessionId: regularSession.id, content: "Hold this ordinary provider request until stopped." });
  await until(() => upstream.calls.length >= holdingStart + 2, "two active provider requests");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("dialog", { name: "Stop MirrorCoding tasks?" }).waitFor();
  await centeredDialog("running-task confirmation centered in narrow window");
  await page.screenshot({ path: join(output, "confirm-centered.png") });
  await page.keyboard.press("Escape");
  check("dismissed confirmation retains account", (await invoke("mirrorcoding/getState")).status === "connected");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Stop tasks and continue", exact: true }).click();
  await until(async () => (await invoke("mirrorcoding/getState")).status === "signed_out", "logout");
  check("logout disables managed providers", (await invoke("providers/list")).providers.filter((provider) => provider.mirrorCoding).every((provider) => !provider.enabled && !provider.hasSecret));
  check("logout leaves ordinary provider task running", !(await page.evaluate((id) => window.__mirrorEvents.some((event) => event.sessionId === id && event.event.type === "agent_end"), regularSession.id)));
  await invoke("agent/abort", { sessionId: regularSession.id });
  upstream.setMode("normal"); const regularStart = upstream.calls.length;
  await invoke("agent/prompt", { sessionId: regularSession.id, content: "Verify ordinary provider still works." });
  await until(() => upstream.calls.length > regularStart, "ordinary provider request");
  check("ordinary provider still sends after MirrorCoding logout", upstream.calls.at(-1).path === "/v1/chat/completions");
  // A second empty profile exercises Login directly from the welcome dialog.
  await closeDesktop(); await openDesktop("welcome-profile");
  await page.getByRole("dialog").getByRole("button", { name: /使用 MirrorCoding 登录|Sign in with MirrorCoding/ }).click();
  const welcomeUrl = await until(() => desktop.evaluate(() => globalThis.__mirrorCodingTestUrl), "welcome authorization URL");
  await consent.goto(welcomeUrl);
  await consent.getByRole("button", { name: /^(Authorize Pi Desktop|授权 Pi Desktop)$/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel(/选择模型|Choose a model/, { exact: true }).waitFor();
  check("first-launch login opens explicit default choice", (await invoke("mirrorcoding/getState")).status === "connected");
  await closeDesktop(); await openDesktop("welcome-profile");
  check("successful first-launch login survives restart", (await invoke("settings/get")).mirrorCodingWelcomeCompleted && !(await page.getByRole("dialog").count()));
  await writeFile(join(output, "report.json"), JSON.stringify({ passed, calls: upstream.calls, service: service.name }, null, 2));
  console.log(`Acceptance artifacts: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(error.message);
  console.log(`Acceptance artifacts: ${output}`);
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify({ passed, catalog, calls: upstream.calls, service: service?.name }, null, 2));
  await closeDesktop().catch(() => {});
  await browser?.close();
  service?.stop();
  upstream.server.closeAllConnections(); upstream.server.close();
}
