import assert from "node:assert/strict";

/** Exercise the visible parent/worker handoff against real Electron and HTTP. */
export async function verifyUltraHandoff({ page, fixture, send, tasks, idle, until, session, invoke, sessionId, screenshot, check }) {
  const initialCalls = fixture.calls.length;
  const initialTasks = (await tasks()).length;
  const initialUsers = (await session()).messages.filter(message => message.role === "user").length;
  const newCalls = () => fixture.calls.slice(initialCalls);
  const parentCalls = () => newCalls().filter(call => call.parent);
  const workers = () => newCalls().filter(call => call.worker);
  await send("CONTROL_YIELD: delegate both independent modules, then wait in the background.");
  await until(() => workers().length === 2, "both Ultra workers start");
  await until(async () => (await tasks()).length === initialTasks + 2, "both Ultra Task rows persist");
  await until(idle, "Ultra parent releases the composer without Stop");
  assert.equal(parentCalls().length, 1);
  assert(workers().every(call => !call.closed));
  assert((await tasks()).slice(initialTasks).every(message => message.toolResult.details.status === "running"));
  assert.equal(await page.getByRole("button", { name: "Stop generating", exact: true }).count(), 0);
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("Draft stays editable while both workers run.");
  assert.equal(await editor.innerText(), "Draft stays editable while both workers run.");
  assert.equal(parentCalls().length, 1);
  check("Ultra dispatches the complete parallel batch, releases the input, and makes no extra parent request");
  await screenshot("ultra-idle-workers-running");

  await send("CONTROL_INPUT: acknowledge this note without cancelling either worker.");
  await until(() => parentCalls().length === 2, "explicit user prompt reaches the idle parent");
  await until(idle, "explicit user answer finishes");
  assert.equal(workers().length, 2);
  assert(workers().every(call => !call.closed));
  await editor.fill("Draft stays editable while both workers run.");
  check("a new user message is answered while both detached workers remain active");

  fixture.releaseWorkers("Channel A");
  await until(() => parentCalls().length === 3, "first report wakes the parent");
  await until(idle, "first silent integration completes");
  assert(workers().find(call => call.group === "中文 Channel B") && !workers().find(call => call.group === "中文 Channel B").closed);
  assert(parentCalls()[2].prompt.includes("CONTROLLED_WORKER_REPORT"));
  assert(parentCalls()[2].body.messages.filter(message => message.role === "tool").every(message => message.content.includes("Actual model: grok-4.7")));
  assert.equal(await editor.innerText(), "Draft stays editable while both workers run.");
  fixture.releaseWorkers("中文 Channel B");
  await until(() => parentCalls().length === 4, "second report wakes the parent");
  await until(async () => (await tasks()).slice(initialTasks).every(message => message.toolResult.details.status === "completed"), "both worker cards complete");
  await until(idle, "all Ultra integration ends");
  assert.equal((await session()).messages.filter(message => message.role === "user").length, initialUsers + 2);
  assert.equal((await invoke("agent/queue/list", { sessionId })).entries.length, 0);
  assert(parentCalls().slice(2).every(call => call.prompt.includes("Subagent reports ready:")));
  assert.equal((await tasks()).slice(initialTasks).length, 2);
  assert.equal(await editor.innerText(), "Draft stays editable while both workers run.");
  check("each settled worker silently wakes integration without polling, fake user bubbles, duplicate workers, or lost drafts");
  await screenshot("ultra-reports-integrated");

  const rapidStart = fixture.calls.length;
  fixture.controls.immediate = true;
  await send("CONTROL_RAPID: dispatch both immediately completing workers.");
  await until(async () => (await tasks()).length === initialTasks + 4, "rapid Task batch persisted");
  await until(async () => (await tasks()).slice(-2).every(message => message.toolResult.details.status === "completed"), "rapid workers completed");
  await until(() => fixture.calls.slice(rapidStart).some(call => call.parent && call.prompt.includes("CONTROLLED_WORKER_REPORT")), "rapid reports delivered");
  await until(idle, "rapid integrations complete");
  const rapidCalls = fixture.calls.slice(rapidStart);
  const rapidParents = rapidCalls.filter(call => call.parent);
  assert.equal(rapidCalls.filter(call => call.worker).length, 2);
  assert.equal(rapidParents.filter(call => !call.prompt.includes("Subagent reports ready:")).length, 1);
  assert(rapidParents.length >= 2 && rapidParents.length <= 3);
  assert.equal((await invoke("agent/queue/list", { sessionId })).entries.length, 0);
  assert.equal((await session()).messages.filter(message => message.role === "user").length, initialUsers + 3);
  check("rapid parallel settlements preserve every report and wake only through the existing silent queue");
  fixture.controls.immediate = false;
}
