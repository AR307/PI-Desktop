import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { desktopPaths, resolveElectronBinary } from "./e2e/boot.mjs";

// Real settings -> IPC -> Rust storage -> runtime -> Anthropic HTTP adapter.
// Only the provider endpoint is simulated; retain profiles and screenshots.
const { _electron } = process.env.PI_E2E_PLAYWRIGHT
  ? await import(pathToFileURL(process.env.PI_E2E_PLAYWRIGHT).href)
  : await import("playwright");
const scratch = mkdtempSync(join(tmpdir(), "pi-claude-cache-"));
console.log("EVIDENCE " + scratch);
writeFileSync(join(scratch, "candidate.json"), JSON.stringify({
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  base: execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim(),
  changes: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }),
}, null, 2));
const dataDir = join(scratch, "data"), project = join(scratch, "project");
mkdirSync(project);
const requests = [];
const modelId = "claude-sonnet-4-6";
const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [modelId, "gpt-5"].map(id => ({ id, object: "model" })) }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const event = (type, data) => res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
  event("message_start", { message: { id: "cache-" + requests.length, type: "message", role: "assistant", model: modelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "CACHE_ACCEPTED_" + requests.length } });
  event("content_block_stop", { index: 0 });
  event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } });
  event("message_stop", {});
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const host = new Host(resolveHostBinary(), dataDir, { quiet: true });
await host.start();
await host.call("workspace.set", { path: project });
const { provider } = await host.call("providers.create", {
  name: "Claude cache fixture", vendorKey: "custom", type: "openai_compatible", protocol: "anthropic",
  baseUrl: "http://127.0.0.1:" + server.address().port, authKind: "none", apiStyle: "anthropic_messages", defaultModelId: modelId,
  models: [modelId, "gpt-5"].map(id => ({ id, contextWindow: 200000, maxTokens: 8192, thinkingLevels: ["off"], defaultThinkingLevel: "off" })),
});
await host.call("settings.set", { language: "en", theme: "dark", mirrorCodingWelcomeCompleted: true, onboardingDismissed: true, autoGenerateTitle: false, defaultProviderId: provider.id, defaultModelId: modelId, defaultMode: "agent", defaultPermissionMode: "ask" });
await host.stop();
const { appDir, electronBinary } = process.env.PI_E2E_ELECTRON
  ? { appDir: desktopPaths().appDir, electronBinary: process.env.PI_E2E_ELECTRON }
  : resolveElectronBinary();
const env = { ...process.env, PI_DESKTOP_DATA_DIR: dataDir, PI_DESKTOP_START_MAXIMIZED: "0", ELECTRON_RENDERER_URL: "" };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const close = async () => {
  if (!app) return;
  const current = app;
  app = undefined;
  await current.evaluate(({ app }) => app.exit(0)).catch(() => {});
};
const launch = async () => {
  app = await _electron.launch({ executablePath: electronBinary, args: ["--user-data-dir=" + join(scratch, "profile"), "."], cwd: appDir, env, timeout: 60000 });
  page = app.windows().find(window => window.url().includes("index.html") && !window.url().includes("plugin-launcher"))
    ?? await app.waitForEvent("window", { predicate: window => window.url().includes("index.html") && !window.url().includes("plugin-launcher"), timeout: 45000 });
  page.setDefaultTimeout(15000);
  await page.locator('.composer-input[contenteditable="true"]').first().waitFor({ timeout: 45000 });
  await page.locator(".startup-splash").waitFor({ state: "hidden", timeout: 45000 });
};
const invoke = (name, input) => page.evaluate(async ({ name, input }) => {
  const result = await window.piDesktop.invoke(window.piDesktop.channels.invoke[name], input);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}, { name, input });
const openModel = async () => {
  await page.locator('[data-nav="settings"]').click();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page.locator('[data-provider-id="' + provider.id + '"]').click();
  const row = page.locator(".provider-chosen-row").filter({ has: page.locator(".provider-chosen-row-id", { hasText: modelId }) });
  await row.locator(".provider-chosen-advanced-toggle").click();
  return row;
};
const choose = async (label, keyboard = false) => {
  const row = await openModel();
  const select = row.getByRole("button", { name: "Claude cache duration", exact: true });
  await select.click();
  if (keyboard) {
    await page.getByRole("option", { name: label, exact: true }).focus();
    await page.keyboard.press("Enter");
  } else await page.getByRole("option", { name: label, exact: true }).click();
  assert.equal(await select.innerText(), label);
  if (label === "5 minutes") {
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes("index.html") && !window.webContents.getURL().includes("plugin-launcher"));
      main.setContentSize(900, 760);
    });
    await select.scrollIntoViewIfNeeded();
    const bounds = await select.boundingBox();
    assert.ok(bounds && bounds.width > 40 && bounds.height > 20);
  }
  await page.screenshot({ path: join(scratch, label.replaceAll(" ", "-") + ".png") });
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await page.locator(".provider-setup-head").waitFor({ state: "hidden" });
  const saved = await invoke("providersList");
  assert.equal(saved.providers.find(p => p.id === provider.id).models.find(m => m.id === modelId).claudeCacheTtl, label === "1 hour" ? "1h" : "5m");
  await page.locator('[data-nav="back-to-app"]').click();
};
function markers(value) {
  return value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => key === "cache_control" ? [child] : markers(child)) : [];
}
const send = async (ttl) => {
  const count = requests.length;
  const input = page.locator('.composer-input[contenteditable="true"]').first();
  await input.fill("Check cache duration " + ttl);
  await input.press("Enter");
  await page.getByText("CACHE_ACCEPTED_" + (count + 1), { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(requests.length, count + 1);
  const controls = markers(requests.at(-1));
  assert.ok(controls.length > 0);
  for (const control of controls) assert.deepEqual(control, ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" });
};
try {
  await launch();
  await choose("1 hour", true);
  await send("1h");
  await close();
  await launch();
  const row = await openModel();
  assert.equal(await row.getByRole("button", { name: "Claude cache duration", exact: true }).innerText(), "1 hour");
  const other = page.locator(".provider-chosen-row").filter({ has: page.locator(".provider-chosen-row-id", { hasText: "gpt-5" }) });
  await other.locator(".provider-chosen-advanced-toggle").click();
  assert.equal(await other.getByRole("button", { name: "Claude cache duration", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-nav="back-to-app"]').click();
  await choose("5 minutes");
  await send("5m");
  await page.screenshot({ path: join(scratch, "chat-requests.png") });
  // Seed only local account metadata: no login, production token or MC request.
  await close();
  await host.start();
  await host.call("providers.syncMirrorCoding", { accountId: 901, groups: [{
    metadata: { scope: "group", accountId: 901, groupId: "fixture", groupName: "Fixture", description: "Local settings fixture", ratio: 1, dynamicBilling: false, routes: { [modelId]: "anthropic" } },
    models: [{ id: modelId, contextWindow: 200000, maxTokens: 8192, thinkingLevels: ["off"], defaultThinkingLevel: "off", mirrorCodingGroupId: "fixture" }],
  }] });
  await host.stop();
  await launch();
  await page.locator('[data-nav="settings"]').click();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  const account = page.locator(".mirrorcoding-model-configs");
  await account.locator(".provider-chosen-advanced-toggle").click();
  const accountSelect = account.getByRole("button", { name: "Claude cache duration", exact: true });
  await accountSelect.click();
  await page.getByRole("option", { name: "1 hour", exact: true }).click();
  await account.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("AI provider saved", { exact: true }).waitFor();
  const accountSaved = await invoke("providersList");
  const accountProvider = accountSaved.providers.find(p => p.mirrorCoding?.scope === "account");
  assert.equal(accountProvider.models.find(m => m.id === modelId).claudeCacheTtl, "1h");
  await page.screenshot({ path: join(scratch, "mirrorcoding-cache.png") });
  console.log("PASS settings selection, keyboard, persistence, restart, non-Claude exclusion, 1h and 5m real requests");
  console.log("PASS MirrorCoding account model settings save without production authentication");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(scratch, "failure.png") });
    writeFileSync(join(scratch, "failure-dom.txt"), await page.locator("body").innerText());
  }
  throw error;
} finally {
  writeFileSync(join(scratch, "requests.json"), JSON.stringify(requests, null, 2));
  await close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  console.log("Retained isolated evidence: " + scratch);
}
