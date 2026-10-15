import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { imageFixture } from "./images/fixture.mjs";

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../..");
const output = join(root, ".artifacts", `session-errors-${Date.now()}`);
const workspace = join(output, "workspace");
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, "powershell.log"), Buffer.concat([
  Buffer.from([0xff, 0xfe]), Buffer.from("Build started\r\n中文日志读取正常\r\n", "utf16le"),
]));
const fixture = await imageFixture();
const checks = [];
let app, page, requestCount = 0, sawDecodedLog = false;
const server = createServer(async (req, res) => {
  if (req.url !== "/v1/chat/completions") {
    const forwarded = request(new URL(req.url, fixture.origin), {
      method: req.method, headers: req.headers,
    }, (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    forwarded.on("error", () => res.writeHead(502).end());
    req.pipe(forwarded);
    return;
  }
  const raw = []; for await (const chunk of req) raw.push(chunk);
  const body = JSON.parse(Buffer.concat(raw).toString());
  requestCount++;
  const lastUser = body.messages.findLastIndex((message) => message.role === "user");
  const results = body.messages.slice(lastUser).filter((message) => message.role === "tool");
  const tool = results.length === 0;
  if (!tool) sawDecodedLog ||= JSON.stringify(results).includes("中文日志读取正常");
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
    id: `controlled-${requestCount}`, object: "chat.completion.chunk", created: 1, model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  })}\n\n`);
  res.writeHead(200, { "content-type": "text/event-stream" });
  chunk({ role: "assistant" });
  if (tool) chunk({ tool_calls: [{ index: 0, id: `read-${requestCount}`, type: "function",
    function: { name: "Read", arguments: JSON.stringify({ path: join(workspace, "powershell.log") }) } }] });
  else chunk({ content: `ENCODED_LOG_INSPECTED_${requestCount}` });
  chunk({}, tool ? "tool_calls" : "stop");
  res.end("data: [DONE]\n\n");
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
async function until(probe, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe(); if (result) return result;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
const invoke = (name, ...args) => page.evaluate(async ({ name, args }) => {
  const result = await window.piDesktop.invoke(`pi-desktop/${name}`, ...args);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}, { name, args });
async function authorize(url) {
  const redirect = await new Promise((done, reject) => {
    request(url, (response) => {
      response.resume();
      response.on("end", () => done(response.headers.location));
    }).on("error", reject).end();
  });
  if (redirect) await authorize(redirect);
}
async function launch() {
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "data"),
    PI_DESKTOP_MIRRORCODING_TEST_ORIGIN: origin, ELECTRON_RENDERER_URL: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: require("electron"),
    args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "profile")}`], env, timeout: 60_000 });
  page = await until(async () => {
    for (const candidate of app.windows()) if (await candidate.locator(".app-shell").count()) return candidate;
  }, "desktop shell", 60_000);
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
}
async function close() {
  if (!app) return;
  await app.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await app.close(); app = undefined;
}
try {
  await launch();
  await app.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__sessionErrorAuth = url; }; });
  await page.getByRole("dialog").getByRole("button", { name: /Sign in with MirrorCoding|使用 MirrorCoding 登录/ }).click();
  await authorize(await until(() => app.evaluate(() => globalThis.__sessionErrorAuth), "fixture login"));
  await until(async () => (await invoke("mirrorcoding/getState")).sync === "success", "catalog");
  const provider = (await invoke("providers/list")).providers.find((value) => value.mirrorCoding?.scope === "account");
  assert.ok(provider);
  await invoke("providers/update", { id: provider.id, models: provider.models.map((model) => model.id === "gpt-5"
    ? { ...model, mirrorCodingGroupId: "中文 分组" } : model) });
  await invoke("settings/set", { ...await invoke("settings/get"), language: "en", theme: "dark",
    autoGenerateTitle: false, defaultProviderId: provider.id, defaultModelId: "gpt-5" });
  const { session } = await invoke("session/create", { title: "Session error regression", projectPath: workspace,
    mode: "agent", providerId: provider.id, modelId: "gpt-5", thinkingLevel: "off", permissionMode: "bypass" });
  await invoke("project/set", workspace);
  await page.reload(); await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.evaluate((id) => window.__PI_DESKTOP__.selectSession(id), session.id);
  await page.evaluate((id) => {
    window.__firstReplyEnded = false;
    window.piDesktop.on("pi-desktop/agent/event/message", (envelope) => {
      if (envelope.sessionId === id && envelope.event.type === "agent_end" && !envelope.parentToolCallId) {
        window.__firstReplyEnded = true;
      }
    });
  }, session.id);
  await invoke("agent/prompt", { sessionId: session.id, content: "Read the PowerShell log and report that it was inspected." });
  await page.getByText("ENCODED_LOG_INSPECTED_2", { exact: true }).waitFor({ timeout: 30_000 });
  await until(() => page.evaluate(() => window.__firstReplyEnded), "initial turn completion");
  check("native Read delivers UTF-16 Chinese log text to the real sidecar", sawDecodedLog);
  await page.screenshot({ path: join(output, "log-read.png") });
  await app.evaluate(() => { process.env.PI_DESKTOP_BOOT_PROBE = "1"; });
  await page.evaluate((id) => {
    window.piDesktop.on("pi-desktop/agent/event/message", (envelope) => {
      if (envelope.sessionId === id && envelope.event.type === "agent_end" && !envelope.parentToolCallId) {
        void window.piDesktop.invoke("pi-desktop/app/quit");
      }
    });
  }, session.id);
  const processExit = once(app.process(), "exit");
  await page.getByText("ENCODED_LOG_INSPECTED_2", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Regenerate/i }).click();
  await processExit; app = undefined;
  check("regenerate finishes and exits through the native quit path", requestCount === 4);
  await launch();
  await page.evaluate((id) => window.__PI_DESKTOP__.selectSession(id), session.id);
  await page.getByText("ENCODED_LOG_INSPECTED_4", { exact: true }).waitFor();
  const detail = (await invoke("session/get", { id: session.id })).session;
  const user = detail.messages.find((message) => message.role === "user");
  const rootUserId = user.revisionRootId ?? user.id;
  const revisions = await invoke("session/listRevisions", { sessionId: session.id, rootUserId });
  check("restarted conversation retains both regenerate branches", revisions.revisions.length === 2);
  const original = await invoke("session/activateRevision", { sessionId: session.id, rootUserId, revisionIndex: 1, prefix: [] });
  check("original branch remains readable", original.messages.some((message) => message.content === "ENCODED_LOG_INSPECTED_2"));
  const regenerated = await invoke("session/activateRevision", { sessionId: session.id, rootUserId, revisionIndex: 2, prefix: [] });
  check("regenerated branch remains readable", regenerated.messages.some((message) => message.content === "ENCODED_LOG_INSPECTED_4"));
  await page.screenshot({ path: join(output, "regenerated-after-restart.png") });
  await close();
  const logs = await readFile(join(output, "data/logs/app/persistence.log"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  check("quit produces no disposed-host archive error", !logs.includes("host-core disposed") && !logs.includes("save.active.regenerate.branch.failed"));
  await writeFile(join(output, "result.json"), JSON.stringify({ checks, requestCount, output }, null, 2));
  console.log(JSON.stringify({ output, checks: checks.length }));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  await close(); server.closeAllConnections(); server.close(); fixture.close();
}
