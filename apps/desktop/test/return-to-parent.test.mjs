import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { buildTranscriptEntries } = await import("../src/lib/assistant-turns.ts");
const { buildToolPresentation } = await import("../src/lib/tool-presentation.ts");
const { getToolAction } = await import("../src/lib/tool-display.ts");
const returned = { id: "run:return", role: "tool", toolName: "ReturnToParent", toolCallId: "run:return", content: "", createdAt: "2026-10-01T00:00:02Z", toolStatus: "success",
  toolResult: { details: { kind: "subagent-return", delegationId: "run", agent: "explorer", status: "completed", report: "Report from channel B.", modelKey: "channel-b/grok-4.7", groupId: "中文 Channel B", thinkingLevel: "xhigh" } } };

test("returns remain separate from process details, Task topology, and child transcript rows", () => {
  const messages = [
    { id: "user", role: "user", content: "Inspect", createdAt: "2026-10-01T00:00:00Z" },
    { id: "task", role: "tool", toolName: "Task", toolCallId: "task", content: "", createdAt: "2026-10-01T00:00:01Z" },
    { id: "read", role: "tool", toolName: "Read", content: "file", createdAt: "2026-10-01T00:00:01Z" },
    returned,
    { id: "child", role: "assistant", parentToolCallId: "task", content: "private child work", createdAt: "2026-10-01T00:00:02Z" },
    { id: "next", role: "tool", toolName: "Read", content: "more", createdAt: "2026-10-01T00:00:03Z" },
  ];
  const { entries, visible } = buildTranscriptEntries(messages);
  assert.deepEqual(visible.map(row => row.id), ["user", "task", "read", "run:return", "next"]);
  assert.deepEqual(entries[1].parts.map(part => part.items.map(item => item.message.id)), [["task"], ["read"], ["run:return"], ["next"]]);
  assert.equal(getToolAction("ReturnToParent"), "delegate");
  assert.equal(getToolAction("plugin.ReturnToParent"), "use");
});

test("expanded return shows report exactly once and the worker's actual binding", () => {
  const blocks = buildToolPresentation(returned);
  assert.equal(blocks.filter(block => block.role === "output").length, 1);
  assert.equal(blocks.find(block => block.role === "output").text, "Report from channel B.");
  assert(JSON.stringify(blocks).includes("channel-b/grok-4.7"));
  assert.match(JSON.stringify(blocks), /中文 Channel B/);
});


test("Task details do not repeat the report already shown in nested child history", () => {
  const task = { ...returned, toolName: "Task", toolResult: { content: [{ type: "text", text: "Report from channel B." }], details: { report: "Report from channel B.", status: "completed" } } };
  const blocks = buildToolPresentation(task, { hideDelegateReport: true });
  assert(!JSON.stringify(blocks).includes("Report from channel B."));
});
