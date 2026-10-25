import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { beginTurn, configureSession, createSession } from "./e2e/session.mjs";
import { waitFor } from "./e2e/wait.mjs";

const scratch = await mkdtemp(join(tmpdir(), "pi-side-background-"));
const workspace = join(scratch, "project");
await mkdir(workspace);
await writeFile(join(workspace, "watch.mjs"), 'console.log("ready"); setInterval(() => {}, 1000);\n');
const host = new Host(resolveHostBinary(), join(scratch, "data"), { quiet: true });
try {
  await host.start();
  const parent = await createSession(host, workspace, "Parent background task");
  await configureSession(host, parent, "agent", "auto");
  const { session: side } = await host.call("sideChat.open", { parentSessionId: parent.id });
  await configureSession(host, side, "agent", "auto");
  const { effective: shell } = await host.call("commandShells.list");
  const command = (shell.dialect === "powershell" ? "& " : "") + JSON.stringify(process.execPath) + " watch.mjs";
  async function start(session) {
    const turnId = await beginTurn(host, session.id);
    const result = await host.call("tools.execute", {
      sessionId: session.id, turnId, toolCallId: "background-" + session.id,
      toolName: "Bash", args: { command, runInBackground: true },
      runInBackground: true, mode: "agent", timeoutMs: 1000,
      expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect,
    });
    assert(result.ok && result.content.backgroundTaskId, JSON.stringify(result));
    return result.content.backgroundTaskId;
  }
  const parentTask = await start(parent);
  const sideTask = await start(side);
  await host.call("tools.abort", { sessionId: side.id, toolCallId: "background-" + side.id });
  assert.equal((await host.call("backgroundTasks.output", { id: sideTask })).state, "running");
  await host.call("sideChat.cleanupPaths", { sessionId: side.id });
  await waitFor(async () => (await host.call("backgroundTasks.output", { id: sideTask })).state === "stopped", 5000, "closing the side chat stops its background command");
  assert.equal((await host.call("backgroundTasks.output", { id: parentTask })).state, "running");
  console.log("PASS side cleanup stops its background task; turn abort and parent task remain independent");
} finally {
  host.child?.stdin.end();
  await host.stop();
  console.log("Evidence retained: " + scratch);
}
