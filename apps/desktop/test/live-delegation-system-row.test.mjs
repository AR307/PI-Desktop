import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { buildTranscriptEntries } = await import("../src/lib/assistant-turns.ts");
const { collectLiveDelegationEntries } = await import("../src/lib/live-delegation-entries.ts");
const { collectDelegationStatuses, subagentOutcome } = await import("../src/lib/subagent-topology.ts");
const row = (id, role, extra = {}) => ({ id, role, content: "", createdAt: "2026-11-08T00:00:00Z", ...extra });
const task = row("task", "tool", { toolName: "Task", toolCallId: "call", status: "complete", toolResult: { details: { delegationId: "delegate", status: "running" } } });

test("running delegation behind a system update stays running after transcript reconstruction", () => {
  const { entries } = buildTranscriptEntries([
    row("prompt", "user", { content: "Inspect" }), task,
    row("system", "system", { content: "Runtime configuration updated" }),
  ]);
  const history = entries.slice(0, -1);
  const live = collectLiveDelegationEntries(history, entries.at(-1), true);
  const turn = history.find(entry => entry.kind === "assistant-turn");
  const items = turn.parts.flatMap(part => part.kind === "activity" ? part.items : []);
  assert.ok(live.has(turn.id));
  const statuses = collectDelegationStatuses(items);
  assert.equal(subagentOutcome(task, statuses), "running");
  assert.equal(collectLiveDelegationEntries(history, entries.at(-1), false).size, 0);
  assert.equal(subagentOutcome(task, collectDelegationStatuses(items)), "running");
  const stopped = row("stop", "tool", { toolName: "TaskStop", status: "complete", toolResult: { details: { stopped: [{ delegationId: "delegate", status: "aborted" }] } } });
  const settled = collectDelegationStatuses([...items, { kind: "tool", message: stopped }]);
  assert.equal(subagentOutcome(task, settled), "aborted");
});

test("a new ordinary prompt still separates earlier delegation state", () => {
  const { entries } = buildTranscriptEntries([
    row("prompt", "user"), task,
    row("system", "system", { content: "Runtime configuration updated" }),
    row("next", "user", { content: "New task" }),
  ]);
  assert.equal(collectLiveDelegationEntries(entries.slice(0, -1), entries.at(-1), true).size, 0);
});
