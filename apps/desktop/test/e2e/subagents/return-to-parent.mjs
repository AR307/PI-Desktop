import assert from "node:assert/strict";

/** Actual worker settlement -> host storage -> visible native disclosure. */
export async function verifyReturnCards({ page, session, until, screenshot, check, label, language = "en" }) {
  const returns = async () => (await session()).messages.filter(message => message.toolName === "ReturnToParent");
  await until(async () => {
    const rows = (await session()).messages;
    const settled = rows.filter(message => message.toolName === "Task" && message.toolResult?.details?.status !== "running");
    return settled.length > 0 && (await returns()).length === settled.length;
  }, "one durable ReturnToParent for each settled run");
  const rows = await returns();
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  const tasks = (await session()).messages.filter(message => message.toolName === "Task");
  for (const row of rows) {
    assert.equal(row.role, "tool");
    assert.equal(row.parentToolCallId, undefined);
    assert.equal(row.toolUsage, undefined);
    const details = row.toolResult.details;
    const task = tasks.find(task => task.toolResult.details.delegationId === details.delegationId);
    assert(task);
    assert.equal(details.status, task.toolResult.details.status);
    assert.equal(details.modelId, task.toolResult.details.modelId);
    assert.equal(details.groupId, task.toolResult.details.groupId);
    assert.equal(details.report, task.toolResult.details.report);
  }
  const last = rows.at(-1);
  const card = page.locator('.subagent-return-group [data-message-id="' + last.id + '"]');
  const header = card.locator(".tool-row-header");
  await header.scrollIntoViewIfNeeded();
  assert.equal(await header.getAttribute("aria-expanded"), "false");
  const status = last.toolResult.details.status;
  const title = language === "zh-CN"
    ? status === "completed" ? "子代理已完成" : ["stopped", "aborted"].includes(status) ? "子代理已停止" : "子代理执行失败"
    : status === "completed" ? "Subagent completed" : ["stopped", "aborted"].includes(status) ? "Subagent stopped" : "Subagent failed";
  assert((await header.innerText()).includes(title));
  await header.focus(); await header.press("Enter");
  await until(async () => (await header.getAttribute("aria-expanded")) === "true", "return details expand by keyboard");
  assert((await card.innerText()).includes(last.toolResult.details.modelId));
  assert((await card.innerText()).includes(last.toolResult.details.groupId));
  const report = last.toolResult.details.report;
  if (report) assert((await card.locator(".tool-row-body").innerText()).includes(report));
  await screenshot("return-" + label);
  await header.click();
  assert.equal(await header.getAttribute("aria-expanded"), "false");
  check("ReturnToParent " + label + ": unique durable rows, actual worker binding, visible collapsed status, keyboard report disclosure");
}
