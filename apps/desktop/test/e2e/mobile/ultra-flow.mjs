import assert from "node:assert/strict";

/** Real desktop controls -> Rust -> relay -> phone -> runtime -> controlled SSE. */
export async function verifyUltraFlow({ page, phone, fixture, invoke, view, until, check, screenshot, shared, provider, autoProvider, mobileSend }) {
  const session = async () => (await invoke("session/get", { id: shared.id })).session;
  await until(async () => !(await view()).snapshot?.activeTurn, "Ultra fixture begins idle");
  await page.locator(".composer-model-thinking-chip").click();
  const slider = page.getByRole("slider", { name: "Reasoning level", exact: true });
  await slider.focus(); await slider.press("End");
  await until(async () => (await session()).ultra === true, "keyboard commits Ultra");
  assert.equal(await slider.getAttribute("aria-valuetext"), "ultra");
  await screenshot("desktop-ultra-slider", page);
  await page.keyboard.press("Escape");
  await until(async () => (await view()).snapshot?.session.configuration.next.ultra === true, "desktop Ultra reaches mobile");
  check("rightmost Ultra tick saves to Rust and synchronizes to the phone");

  await phone.locator(".conversation-controls .model-chip").click();
  await phone.getByLabel("Thinking level", { exact: true }).selectOption("ultra");
  await screenshot("mobile-ultra-sheet");
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await phone.locator(".surface").waitFor({ state: "hidden" });
  const start = fixture.chats.length;
  await mobileSend("mobile-ultra-parallel: independently inspect two modules and combine the results.");
  await until(() => fixture.control.ultraWorkers === 2, "two Ultra workers overlap before either finishes");
  const requests = fixture.chats.slice(start);
  const root = requests.find(body => body.tools?.some(tool => tool.function.name === "Task"));
  assert(root.messages.some(message => JSON.stringify(message).includes("Proactively split")));
  const children = requests.filter(body => JSON.stringify(body.messages).includes("ULTRA_WORKER_") && !body.tools?.some(tool => tool.function.name === "Task"));
  assert.equal(children.length, 2);
  assert.deepEqual(new Set(children.map(body => body.model)), new Set(["gpt-5", "gpt-5.1"]));
  for (const body of [root, ...children]) {
    assert.equal(body.ultra, undefined);
    assert.notEqual(body.reasoning_effort, "ultra");
    assert(body.reasoning_effort && body.reasoning_effort !== "off");
    assert.equal(body.service_tier, undefined);
  }
  check("real relay requests run same-model and authorized cross-model workers concurrently with native reasoning, not Ultra or Fast wire parameters");
  await until(async () => !(await view()).snapshot?.activeTurn, "parent finishes while workers remain active");
  await invoke("session/configure", shared.id, { mode: "agent", providerId: autoProvider.id, modelId: "gpt-5", thinkingLevel: "low" });
  await mobileSend("Check parent rebind while the independent modules are still being inspected.");
  await until(async () => (await session()).messages.filter(message => message.role === "assistant" && !message.parentToolCallId).length > 0 && !(await view()).snapshot?.activeTurn, "next parent turn finishes without stopping workers");
  fixture.releaseChats();
  await until(async () => (await session()).messages.filter(message => message.toolName === "Task" && message.toolResult?.details?.status === "completed").length >= 2, "Ultra reports are persisted");
  const tasks = (await session()).messages.filter(message => message.toolName === "Task");
  for (const task of tasks) {
    assert.equal(task.toolResult?.details?.thinkingLevel, "high");
    assert(task.toolResult?.details?.modelKey);
    assert.equal(task.toolResult?.details?.groupId, provider.mirrorCoding.groupId);
  }
  await until(async () => !(await view()).snapshot?.activeTurn && !(await view()).snapshot?.queuedTurns?.length, "Ultra parent converges");
  check("completed worker records retain their effective thinking levels");
  await screenshot("mobile-ultra-workers");
  fixture.control.ultraResume = tasks.find(task => task.toolResult.details.modelId === "gpt-5.1").toolResult.details.delegationId;
  await mobileSend("mobile-ultra-resume: continue the earlier independent inspection");
  await until(async () => (await session()).messages.some(message => message.toolName === "Task" && message.toolArgs?.resume === fixture.control.ultraResume && message.toolResult?.details?.status === "completed"), "resume retains worker reasoning after parent model switch");
  const resumed = (await session()).messages.find(message => message.toolArgs?.resume === fixture.control.ultraResume);
  assert.equal(resumed.toolResult.details.thinkingLevel, "high");
  assert.equal(resumed.toolResult.details.groupId, provider.mirrorCoding.groupId);
  check("worker resume retains its original group and native reasoning rather than the next parent selection");
  await until(async () => !(await view()).snapshot?.activeTurn && !(await view()).snapshot?.queuedTurns?.length, "resume converges");
  await invoke("session/configure", shared.id, { mode: "agent", providerId: provider.id, modelId: "gpt-5", ultra: true });

  await mobileSend("mobile-slow Ultra current/next test");
  await until(async () => (await view()).snapshot?.session.configuration.current?.ultra === true, "Ultra current task snapshot");
  await phone.locator(".conversation-controls .model-chip").click();
  await phone.getByLabel("Thinking level", { exact: true }).selectOption("low");
  await phone.getByRole("button", { name: "Apply", exact: true }).click();
  await phone.locator(".surface").waitFor({ state: "hidden" });
  await until(async () => {
    const config = (await view()).snapshot?.session.configuration;
    return config?.current?.ultra === true && config.next.ultra === false && config.next.thinkingLevel === "low";
  }, "Ultra remains on the running turn while ordinary next-turn reasoning is saved");
  fixture.releaseChats();
  await until(async () => !(await view()).snapshot?.activeTurn, "Ultra turn completes");
  check("mobile changes only the next turn, without changing the active Ultra task");

  await invoke("session/configure", shared.id, { mode: "agent", ultra: true });
  await invoke("session/configure", shared.id, { mode: "agent", providerId: autoProvider.id, modelId: "gpt-5" });
  assert.equal((await session()).ultra, false);
  await invoke("session/configure", shared.id, { mode: "agent", providerId: provider.id, modelId: "gpt-5", thinkingLevel: "medium", ultra: false });
  await until(async () => (await view()).snapshot?.session.configuration.next.providerId === provider.id && !(await view()).snapshot?.session.configuration.next.ultra, "ordinary settings restored");
  check("changing an MC group resets Ultra and restores ordinary configuration");
}
