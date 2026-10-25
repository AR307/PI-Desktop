import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { Host } from "./host.mjs";
import { OfflineSidecar } from "./hosted-search-sidecar.mjs";
import { startProvider, providerConfig } from "./hosted-search-provider.mjs";
import { loadInstructionChain } from "../../packages/agent-runtime/dist/project-instructions.js";

const root = resolve(import.meta.dirname, "../..");
const dir = join(root, "artifacts", `codex-continuation-${Date.now()}`);
const workspace = join(dir, "workspace");
await mkdir(join(dir, "source/sessions"), { recursive: true }); await mkdir(workspace);
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
await require("esbuild").build({ entryPoints: [join(root, "packages/agent-runtime/src/sidecar.ts")], bundle: true, platform: "node", format: "esm", splitting: true, outdir: join(dir, "runtime"), entryNames: "sidecar", chunkNames: "chunks/[name]-[hash]", define: { PI_BUNDLED_NODE: "true" }, banner: { js: 'import { createRequire as __piCreateRequire } from "node:module"; const require = __piCreateRequire(import.meta.url);' } });
await writeFile(join(dir, "runtime/package.json"), JSON.stringify({ type: "module" }));
await writeFile(join(workspace, "fixture.txt"), "REAL_FILE_CONTENT");
const message = (role, text) => ({ type: "response_item", payload: { type: "message", role, content: [{ type: "input_text", text }] } });
const source = [
  { type: "session_meta", payload: { id: "continue", cwd: workspace, timestamp: "2026-10-25T00:00:00Z" } },
  message("user", "OBSOLETE_BEFORE_COMPACTION"),
  { type: "compacted", payload: { message: "DUPLICATE_SUMMARY_MUST_NOT_APPEAR", replacement_history: [message("user", "EFFECTIVE_SUMMARY").payload] } },
  { type: "response_item", payload: { type: "custom_tool_call", call_id: "historical-write", name: "Write", input: "DO_NOT_REPLAY_OLD_TOOL" } },
  { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "historical-write", output: "HISTORICAL_RESULT" } },
  message("assistant", "LATEST_ANSWER"),
].map(r => JSON.stringify(r)+"\n").join("");
await writeFile(join(dir, "source/sessions/continue.jsonl"), source);
const host = new Host(process.env.PI_DESKTOP_HOST_BIN || join(root, "target/debug", process.platform === "win32" ? "pi-desktop-host-core.exe" : "pi-desktop-host-core"), join(dir, "data"), { quiet: true });
await host.start();
const scan = await host.call("codex.import.scan", { directory: join(dir, "source") });
const result = await host.call("codex.import.run", { scanId: scan.scanId, externalId: "continue", runId: "continuation-run" });
assert.equal(result.status, "imported"); assert.equal(result.context, "restored");
const sessionId = result.sessionId;
await host.call("session.configure", { id: sessionId, mode: "agent", permissionMode: "accept-edits" });
let sidecar; let calls = 0;
const provider = await startProvider(dir, (body, requests) => {
  const input = JSON.stringify(body.input);
  assert.match(input, /EFFECTIVE_SUMMARY/); assert.match(input, /LATEST_ANSWER/); assert.match(input, /HISTORICAL_RESULT/);
  assert.doesNotMatch(input, /OBSOLETE_BEFORE_COMPACTION|DUPLICATE_SUMMARY_MUST_NOT_APPEAR/);
  assert(!body.input.some(i => i.type === "function_call" && i.call_id === "historical-write"));
  if (requests.length === 1) return { tool: { name: "Read", args: { path: "fixture.txt" } } };
  if (requests.length === 2) { assert.match(input,/REAL_FILE_CONTENT/); return { tool: { name: "Write", args: { path: "continued.txt", content: "NEW_PI_TOOL_RESULT" } } }; }
  if (requests.length === 3) return { text: "CONTINUATION_COMPLETED" };
  assert.match(input, /CONTINUATION_COMPLETED/); return { text: "RESTART_CONTINUED" };
});
const route = async (method, params) => {
  if (method === "project.instructions.resolve") return loadInstructionChain(workspace, params.path, join(dir, "no-global-instructions.md"));
  if (method === "tools.execute") calls++;
  return host.call(method, params);
};
const params = { sessionId, mode: "agent", thinkingLevel: "off", infiniteProviderRetry: false,
  commandShell: { id: "windows-powershell", label: "PowerShell", dialect: "powershell", available: true, isDefault: true },
  provider: providerConfig(provider.baseUrl), projectPath: workspace, scratchDir: join(dir, "scratch"), pluginTools: [], pluginSkills: [], trustedExtensions: [] };
async function prompt(content) {
  const { turnId } = await host.call("session.beginTurn", { sessionId });
  await host.call("session.appendMessage", { sessionId, turnId, message: { id: `${turnId}-user`, role: "user", content, status: "complete", createdAt: new Date().toISOString() } });
  await sidecar.prompt(params, content);
  // Electron's event persistence path owns completed assistant/tool rows.
  // Use the same Host append boundary before stopping the isolated runtime.
  for (const message of sidecar.messages.values()) {
    if (message.role !== "user") await host.call("session.appendMessage", { sessionId, turnId, message });
  }
  await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
}
try {
  sidecar = await OfflineSidecar.start(join(dir, "runtime/sidecar.js"), join(dir, "runtime-one"), route, 20000);
  await prompt("Read fixture.txt and write continued.txt; use the imported context.");
  assert.equal(await readFile(join(workspace, "continued.txt"), "utf8"), "NEW_PI_TOOL_RESULT"); assert.equal(calls,2);
  await sidecar.stop(); await host.restart();
  sidecar = await OfflineSidecar.start(join(dir, "runtime/sidecar.js"), join(dir, "runtime-two"), route, 20000);
  await prompt("Continue after restart without running tools again."); assert.equal(calls,2);
  const again = await host.call("codex.import.scan", { directory: join(dir, "source") });
  assert.equal((await host.call("codex.import.run", { scanId: again.scanId, externalId: "continue", runId: "continuation-run" })).status, "skipped");
  assert.equal(await readFile(join(dir, "source/sessions/continue.jsonl"), "utf8"),source);
  provider.check(); console.log(JSON.stringify({ ok: true, requests: provider.requests.length, newToolCalls: calls, evidence: dir }));
} finally { await sidecar?.stop(); await host.stop(); await provider.close(); }
