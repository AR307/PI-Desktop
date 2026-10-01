import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { HostProcess } from "@pi-desktop/host-runtime";
import { subagentFixture } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", "subagent-controls-" + Date.now()));
const binaryPath = process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe");
const fixture = await subagentFixture(), passed = [], errors = [];
let desktop, page, sessionId;
await mkdir(output, { recursive: true });
const check = (label, value = true) => { assert(value, label); passed.push(label); console.log("PASS " + label); };
const until = async (probe, label, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error("Timed out: " + label);
};
const invoke = (channel, ...args) => page.evaluate(async ({ channel, args }) => {
  const result = await window.piDesktop.invoke("pi-desktop/" + channel, ...args);
  if (!result.ok) throw Error(result.error.message);
  return result.data;
}, { channel, args });
const session = async () => (await invoke("session/get", { id: sessionId })).session;
const tasks = async () => (await session()).messages.filter(message => message.toolName === "Task");
const idle = async () => !(await invoke("agent/getStatus", sessionId)).status.isRunning;
const send = async text => { const editor = page.locator('[contenteditable="true"]').first(); await editor.fill(text); await editor.press("Enter"); };
const screenshot = async name => page.screenshot({ path: join(output, name + ".png"), fullPage: true });
try {
  const workspace = join(output, "workspace"); await mkdir(workspace, { recursive: true });
  const host = new HostProcess({ binaryPath, dataDir: join(output, "profile"), onStderr() {} });
  try {
    await host.handshake();
    await host.call("settings.set", { language: "en", theme: "dark", developerMode: false, mirrorCodingWelcomeCompleted: false });
    sessionId = (await host.call("session.create", { title: "Subagent controls acceptance", projectPath: workspace, mode: "agent" })).session.id;
  } finally { await host.dispose(); }
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "profile"), PI_DESKTOP_HOST_BIN: binaryPath, PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: fixture.origin };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  desktop = await _electron.launch({ executablePath: require("electron"), args: [join(root, "apps/desktop"), "--user-data-dir=" + join(output, "electron")], env, timeout: 60000 });
  const main = candidate => candidate.url().endsWith("/renderer/index.html");
  page = desktop.windows().find(main) ?? await desktop.waitForEvent("window", { predicate: main, timeout: 60000 });
  page.setDefaultTimeout(20000); page.on("pageerror", error => errors.push(error.message));
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(".startup-splash").waitFor({ state: "hidden" });
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__testAuthUrl = url; }; });
  await page.getByRole("dialog").getByRole("button", { name: /Sign in with MirrorCoding|使用 MirrorCoding 登录/ }).click();
  await fetch(await until(() => desktop.evaluate(() => globalThis.__testAuthUrl), "login URL"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "catalog login");
  const providers = (await invoke("providers/list")).providers;
  const account = providers.find(row => row.mirrorCoding?.scope === "account");
  const groups = ["Channel A", "中文 Channel B"].map(name => providers.find(row => row.mirrorCoding?.scope === "group" && row.mirrorCoding.groupId === name));
  assert(groups.every(Boolean));
  await invoke("providers/update", { id: account.id, models: account.models.map(model => ({ ...model, availableForSubagents: model.id === "grok-4.7", mirrorCodingGroupId: "Channel A" })) });
  fixture.controls.keys = groups.map(group => group.id + "/grok-4.7");
  await invoke("session/configure", sessionId, { mode: "agent", providerId: groups[0].id, modelId: "gpt-6-astra", ultra: true, permissionMode: "ask" });
  await invoke("settings/set", { ...await invoke("settings/get"), language: "en", theme: "dark" });
  await invoke("project/set", workspace);
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor(); await page.locator(".startup-splash").waitFor({ state: "hidden" });
  await page.locator('[data-sidebar-session-row="' + sessionId + '"] .thread-item-main').first().click();

  await send("CONTROL_PARALLEL: use Grok 4.7 on both requested channels.");
  await until(() => fixture.calls.filter(call => call.worker).length === 2, "two independent streamed workers");
  await until(async () => (await tasks()).length === 2, "Task records persisted");
  const children = fixture.calls.filter(call => call.worker);
  assert(children.every(call => call.body.model === "grok-4.7"));
  assert.deepEqual(new Set(children.map(call => call.group)), new Set(["Channel A", "中文 Channel B"]));
  const rootCall = fixture.calls.find(call => call.parent);
  for (const key of fixture.controls.keys) assert(JSON.stringify(rootCall.body).includes(key));
  check("Astra explicitly starts Grok 4.7 on two distinct MC channels; catalog and wire agree");
  await until(() => fixture.calls.some(call => call.parent && call.body.messages.some(message => message.role === "tool")), "parent receives actual binding");
  const continuation = fixture.calls.find(call => call.parent && call.body.messages.some(message => message.role === "tool"));
  assert(continuation.body.messages.filter(message => message.role === "tool").every(message => message.content.includes("Actual model: grok-4.7")));
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await until(idle, "parent stopped");
  await until(async () => await page.locator(".subagent-topology-node.outcome-running").count() === 2, "children still render running");
  assert(children.every(call => !call.closed));
  assert((await tasks()).every(message => message.toolResult.details.status === "running"));
  check("stopping the parent leaves both actual worker streams and cards running");
  await screenshot("running-after-parent-stop");
  const stopOne = page.getByRole("button", { name: "Stop subagent", exact: true }).first();
  await stopOne.focus(); await stopOne.press("Enter");
  await until(async () => (await tasks()).filter(message => message.toolResult.details.status === "stopped").length === 1, "individual cancellation settled");
  assert.equal(children.filter(call => !call.closed).length, 1);
  await page.getByRole("button", { name: "Stop all subagents", exact: true }).first().click();
  await until(async () => (await tasks()).every(message => message.toolResult.details.status === "stopped"), "all workers stopped");
  await until(() => children.every(call => call.closed), "all upstream streams closed");
  check("keyboard stop cancels only one worker; group stop cancels remaining workers");
  await screenshot("workers-stopped");

  await send("CONTROL_REPORT: run and deliver one background report.");
  await until(async () => (await tasks()).length === 3, "report worker starts");
  await until(idle, "parent idles while worker is active");
  fixture.releaseWorkers();
  await until(() => fixture.calls.some(call => call.parent && call.prompt.includes("CONTROLLED_WORKER_REPORT")), "report reaches parent model internally");
  await until(async () => (await session()).messages.some(message => !message.parentToolCallId && message.role === "assistant" && message.content.includes("Parent received the internal")), "parent report integrated");
  await until(idle, "silent notification turn settles");
  const rows = (await session()).messages;
  assert.deepEqual(rows.filter(message => message.role === "user").map(message => message.content), ["CONTROL_PARALLEL: use Grok 4.7 on both requested channels.", "CONTROL_REPORT: run and deliver one background report."]);
  assert.equal((await invoke("agent/queue/list", { sessionId })).entries.length, 0);
  check("background report wakes the parent without a visible or persisted fake user message");
  await screenshot("silent-report-delivered");

  fixture.controls.failChild = true;
  await send("CONTROL_FAIL: a rejected Grok channel must not become Astra.");
  await until(async () => (await tasks()).some(message => message.toolResult.details.status === "failed"), "controlled rejection recorded");
  await until(idle, "failed worker parent idle");
  const failed = (await tasks()).find(message => message.toolResult.details.status === "failed");
  assert.equal(failed.toolResult.details.modelId, "grok-4.7");
  fixture.controls.resume = failed.toolResult.details.delegationId;
  await send("CONTROL_RESUME: continue the same worker without changing its channel.");
  await until(async () => (await tasks()).some(message => message.toolArgs?.resume === fixture.controls.resume), "resumed worker starts");
  await until(() => fixture.calls.filter(call => call.worker).length === 5, "resume sends upstream request");
  fixture.releaseWorkers();
  await until(async () => (await tasks()).some(message => message.toolArgs?.resume === fixture.controls.resume && message.toolResult.details.status === "completed"), "resumed worker finishes");
  const resumed = (await tasks()).find(message => message.toolArgs?.resume === fixture.controls.resume);
  assert.equal(resumed.toolResult.details.modelId, "grok-4.7"); assert.equal(resumed.toolResult.details.groupId, "Channel A");
  assert.equal(fixture.calls.filter(call => call.worker).at(-1).body.model, "grok-4.7");
  check("failed delegation resumes on its exact Grok model/channel, never inherited Astra");
  await until(idle, "resume settled");
  await invoke("settings/set", { ...await invoke("settings/get"), language: "zh-CN", theme: "light" });
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor(); await page.locator(".startup-splash").waitFor({ state: "hidden" });
  await page.locator('[data-sidebar-session-row="' + sessionId + '"] .thread-item-main').first().click();
  await screenshot("persisted-light-zh");
  assert.equal((await tasks()).at(-1).toolResult.details.modelId, "grok-4.7");
  check("reload preserves settled status and actual model/channel in Chinese light theme");
  assert.deepEqual(errors, []);
} catch (error) {
  if (page) { await screenshot("failure").catch(() => {}); await writeFile(join(output, "visible.txt"), await page.locator("body").innerText().catch(() => "unavailable")); }
  throw error;
} finally {
  if (desktop) { await desktop.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; }).catch(() => {}); await desktop.close(); }
  fixture.close();
  await writeFile(join(output, "result.json"), JSON.stringify({ candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), passed, errors, requests: fixture.calls.map(({ body, group, parent, closed }) => ({ model: body.model, group, parent, closed })) }, null, 2));
  console.log("Evidence: " + output);
}
