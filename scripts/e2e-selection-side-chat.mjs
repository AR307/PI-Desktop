import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { desktopPaths, resolveElectronBinary } from "./e2e/boot.mjs";
import { waitFor } from "./e2e/wait.mjs";
import { assertSideChatLayout } from "./e2e/side-chat-layout.mjs";
import { assertMessageQuotes, assertSelectionActions } from "./e2e/selected-reference-layout.mjs";

// Real Electron, preload, Host and runtime; only the HTTP provider is controlled.
// Retain isolated profiles and screenshots instead of deleting test files.
const scratch = mkdtempSync(join(tmpdir(), "pi-selection-side-chat-"));
const dataDir = join(scratch, "data"),
  project = join(scratch, "project");
mkdirSync(project);
console.log("EVIDENCE " + scratch);
const requests = [],
  held = new Set();
let finishParent;
const content = (value) => (typeof value === "string" ? value : JSON.stringify(value));
const answer =
  "最近完整回复：中文选文测试。\n\n第二段保留来源。\n\n~~~js\nconst answer = 42;\nconsole.log(answer);\n~~~\n\n公式：$E=mc^2$。";
const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: ["fixture", "fixture-reasoning"].map((id) => ({ id, object: "model" })),
      }),
    );
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const lastUser = content(body.messages?.findLast((m) => m.role === "user")?.content ?? "");
    res.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (delta, finish_reason = null) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "fixture-" + requests.length,
            object: "chat.completion.chunk",
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    const finish = (text) => {
      emit({ role: "assistant", content: text });
      emit({}, "stop");
      res.end("data: [DONE]\n\n");
    };
    if (lastUser.includes("NO_OUTPUT_SIDE")) {
      res.flushHeaders();
      held.add(res);
      res.on("close", () => held.delete(res));
      return;
    }
    if (lastUser.includes("HOLD_PARENT") || lastUser.includes("HOLD_SIDE")) {
      if (lastUser.includes("HOLD_PARENT")) finishParent = () => finish("PARENT_STREAM_COMPLETE");
      emit({
        role: "assistant",
        content: lastUser.includes("HOLD_SIDE") ? "侧聊正在运行" : "主对话正在运行",
      });
      held.add(res);
      res.on("close", () => held.delete(res));
      return;
    }
    if (lastUser.includes("SIDE_DELEGATE")) {
      const isOwner = body.tools?.some((tool) => tool.function?.name === "Task");
      if (!isOwner) {
        emit({ role: "assistant", content: "DELEGATE_WAITING" });
        held.add(res);
        res.on("close", () => held.delete(res));
      } else if (!body.messages.some((message) => message.tool_call_id === "side-delegate")) {
        const task = body.tools.find((tool) => tool.function?.name === "Task");
        const agent = task.function.parameters.properties.agent.enum?.[0] ?? "explorer";
        emit({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "side-delegate",
              type: "function",
              function: {
                name: "Task",
                arguments: JSON.stringify({
                  agent,
                  task: "SIDE_DELEGATE: inspect the shared workspace without changing files.",
                }),
              },
            },
          ],
        });
        emit({}, "tool_calls");
        res.end("data: [DONE]\n\n");
      } else finish("DELEGATE_STARTED");
    } else if (lastUser.includes("SIDE_BACKGROUND")) {
      if (body.messages.some((m) => m.role === "tool" && m.tool_call_id === "side-background")) {
        finish("SIDE_BACKGROUND_READY");
      } else {
        emit({ role: "assistant", tool_calls: [{ index: 0, id: "side-background", type: "function", function: {
          name: "Bash", arguments: JSON.stringify({ command: "& " + JSON.stringify(process.execPath) + " side-watch.mjs", runInBackground: true }),
        } }] });
        emit({}, "tool_calls");
        res.end("data: [DONE]\n\n");
      }
    } else if (lastUser.includes("SIDE_WRITE") || lastUser.includes("SIDE_DENIED_WRITE")) {
      if (body.messages.some((m) => m.role === "tool" && m.tool_call_id === "side-write"))
        finish("SIDE_DONE：文件已写入共享目录。");
      else {
        emit({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "side-write",
              type: "function",
              function: {
                name: "Write",
                arguments: JSON.stringify({
                  path: lastUser.includes("SIDE_DENIED_WRITE")
                    ? "must-not-exist.txt"
                    : "side-chat-proof.txt",
                  content: "side chat wrote this\n",
                }),
              },
            },
          ],
        });
        emit({}, "tool_calls");
        res.end("data: [DONE]\n\n");
      }
    } else finish(answer);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const host = new Host(resolveHostBinary(), dataDir, { quiet: true });
await host.start();
await host.call("workspace.set", { path: project });
const { provider } = await host.call("providers.create", {
  name: "Local fixture",
  vendorKey: "custom",
  type: "openai_compatible",
  protocol: "openai_compatible",
  baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
  authKind: "none",
  defaultModelId: "fixture",
  apiStyle: "chat_completions",
  models: [
    {
      id: "fixture",
      contextWindow: 128000,
      maxTokens: 8192,
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    },
    {
      id: "fixture-reasoning",
      contextWindow: 128000,
      maxTokens: 8192,
      thinkingLevels: ["off", "low", "high"],
      defaultThinkingLevel: "low",
    },
  ],
});
await host.call("settings.set", {
  language: "zh-CN",
  theme: "dark",
  mirrorCodingWelcomeCompleted: true,
  onboardingDismissed: true,
  autoGenerateTitle: false,
  defaultProviderId: provider.id,
  defaultModelId: "fixture",
  defaultMode: "agent",
  defaultPermissionMode: "ask",
});
await host.stop();
const { appDir, electronBinary } = process.env.PI_SELECTION_ELECTRON
  ? { appDir: desktopPaths().appDir, electronBinary: process.env.PI_SELECTION_ELECTRON }
  : resolveElectronBinary();
const port = Number(process.env.PI_SELECTION_CDP_PORT || 9487);
const env = {
  ...process.env,
  PI_DESKTOP_DATA_DIR: dataDir,
  PI_DESKTOP_START_MAXIMIZED: "0",
  ELECTRON_RENDERER_URL: "",
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  spawn(
    electronBinary,
    ["--remote-debugging-port=" + port, "--user-data-dir=" + join(scratch, "profile"), "."],
    { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
let child = launch();
let log = "",
  ws,
  failureEvidence;
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (data) => {
    log += data;
  });
let closed = once(child, "close");
try {
  let target;
  await waitFor(
    async () => {
      try {
        target = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).find(
          (e) =>
            e.type === "page" && e.url.includes("index.html") && !e.url.includes("plugin-launcher"),
        );
        return !!target;
      } catch {
        return false;
      }
    },
    45000,
    "desktop target",
  );
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, "open");
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data),
      entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails),
      );
    return r.result.value;
  };
  const invoke = (name, ...args) =>
    evaluate(
      "(async()=>{const r=await window.piDesktop.invoke(window.piDesktop.channels.invoke[" +
        JSON.stringify(name) +
        "],..." +
        JSON.stringify(args) +
        ");if(!r.ok)throw new Error(JSON.stringify(r.error));return r.data;})()",
    );
  const key = async (name, code) => {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      ...(name === "Enter" ? { text: "\r" } : {}),
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
    });
  };
  const click = async (selector) => {
    await evaluate(
      "Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))",
    );
    await evaluate(
      "new Promise(resolve=>{let last='',stable=0;const sample=()=>{const e=document.querySelector(" +
        JSON.stringify(selector) +
        ");if(!e){resolve();return;}e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),next=[r.x,r.y,r.width,r.height].join(',');stable=next===last?stable+1:0;last=next;if(stable>=2)resolve();else requestAnimationFrame(sample);};sample();})",
    );
    const point = await evaluate(
      "(()=>{const e=document.querySelector(" +
        JSON.stringify(selector) +
        ");if(!e)throw new Error('Missing target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  };
  const screenshot = async (name) => {
    await evaluate(
      "Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))",
    );
    const result = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(scratch, name), Buffer.from(result.data, "base64"));
  };
  failureEvidence = async () => {
    await screenshot("failure.png");
    console.log(await evaluate("document.body.innerText"));
    const side = await evaluate("document.querySelector('[data-side-chat]')?.dataset.sideChat");
    if (side)
      console.log(
        "SIDE DIAGNOSTICS",
        JSON.stringify({
          status: await invoke("agentGetStatus", side),
          queue: await invoke("agentQueueList", { sessionId: side }),
          editors: await evaluate(
            "[...document.querySelectorAll('.composer-input')].map(e=>({text:e.innerText,html:e.innerHTML}))",
          ),
        }),
      );
  };
  const mainInput = '.composer-input[contenteditable="true"]',
    sideInput = '.side-chat-pane .composer-input[contenteditable="true"]';
  const type = async (selector, text) => {
    await evaluate(
      "new Promise(resolve=>{let last='',stable=0;const sample=()=>{const r=document.querySelector(" +
        JSON.stringify(selector) +
        ").getBoundingClientRect();const next=JSON.stringify([r.x,r.y,r.width,r.height]);stable=next===last?stable+1:0;last=next;if(stable>=4)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);})",
    );
    await click(selector);
    assert.ok(
      await evaluate(
        "document.activeElement===document.querySelector(" + JSON.stringify(selector) + ")",
      ),
      "clicked editor receives focus",
    );
    await send("Input.insertText", { text });
  };
  const select = async (selector) => {
    await evaluate(
      "new Promise(resolve=>{const e=document.querySelector(" + JSON.stringify(selector) +
      ");if(!e)throw new Error('Missing quote body');e.scrollIntoView({block:'center'});let last='',stable=0;const sample=()=>{const r=e.getBoundingClientRect(),next=[r.x,r.y,r.width,r.height].join(',');stable=next===last?stable+1:0;last=next;if(stable>=4)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);})",
    );
    await evaluate(
      "(()=>{const e=document.querySelector(" +
        JSON.stringify(selector) +
        ");if(!e)throw new Error('Missing quote body');const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()",
    );
    await waitFor(
      () => evaluate("!!document.querySelector('.selection-actions')"),
      5000,
      "selection menu",
    );
  };
  await waitFor(
    () =>
      evaluate(
        "!!document.querySelector('.composer-input[contenteditable=true]')&&!document.querySelector('.startup-splash')",
      ),
    45000,
    "composer ready",
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(e=>e.textContent.includes('暂时跳过'))?.click()",
  );
  await type(mainInput, "INITIAL_CONTEXT");
  await key("Enter", 13);
  await waitFor(
    () => evaluate("document.body.innerText.includes('最近完整回复')"),
    30000,
    "first reply",
  );
  const { sessions } = await invoke("sessionList");
  const parent = sessions.find((s) => !s.id.startsWith("side-"));
  assert.ok(parent);
  const menuPoint = await evaluate("(()=>{const e=document.querySelector('[data-sidebar-session-row=\"" + parent.id + "\"] [data-action=\"session-menu\"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...menuPoint });
  await waitFor(() => evaluate("(()=>{const e=document.querySelector('[data-sidebar-session-row=\"" + parent.id + "\"] [data-action=\"session-menu\"]');const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"), 5000, "hover-revealed session menu becomes actionable");
  await click('[data-sidebar-session-row="' + parent.id + '"] [data-action="session-menu"]');
  await waitFor(() => evaluate("!!document.querySelector('[data-action=sync-session-mobile]')"), 5000, "mobile action preserved in upstream sidebar menu");
  await click('[data-submenu-trigger="session-copy"]');
  await waitFor(() => evaluate("!!document.querySelector('[data-action=copy-session-path]')"), 5000, "upstream session copy submenu");
  assert.ok(await evaluate("!!document.querySelector('[data-action=copy-conversation-id]') && !!document.querySelector('[data-action=copy-session-link]')"));
  await screenshot("upstream-sidebar-copy-menu.png");
  await key("Escape", 27);
  await key("Escape", 27);
  await evaluate(
    "(()=>{const bodies=[...document.querySelectorAll('[data-quote-body]')];const hidden=document.createElement('span');hidden.hidden=true;hidden.textContent='HIDDEN_NOT_QUOTED';bodies[1].append(hidden);const r=document.createRange();r.setStart(bodies[0],0);r.setEnd(bodies[1],bodies[1].childNodes.length);const s=window.getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()",
  );
  await waitFor(
    () => evaluate("!!document.querySelector('.selection-actions')"),
    5000,
    "cross-message menu",
  );
  await click(".selection-actions button:first-child");
  await click(".composer-dock [data-message-quotes] summary");
  assert.equal(
    await evaluate("document.querySelectorAll('.composer-dock .message-quote').length"),
    2,
  );
  assert.doesNotMatch(
    await evaluate("document.querySelector('.composer-dock .message-quotes').textContent"),
    /HIDDEN_NOT_QUOTED/,
  );
  await click(".composer-dock .message-quote button");
  await click(".composer-dock .message-quote button");
  await type(mainInput, "原有草稿。");
  await select("[data-quote-body] p");
  await screenshot("selection-dark.png");
  await assertSelectionActions(evaluate);
  await click(".selection-actions button:first-child");
  assert.ok(
    await evaluate("document.querySelector('.composer-input').innerText.includes('原有草稿')"),
  );
  await waitFor(
    () => evaluate("!!document.querySelector('.composer-dock [data-message-quotes]')"),
    5000,
    "quote draft",
  );
  await select("[data-quote-body] pre");
  await click(".selection-actions button:first-child");
  await select("[data-quote-body] .katex");
  await key("Tab", 9);
  await key("Enter", 13);
  await click(".composer-dock [data-message-quotes] summary");
  assert.equal(
    await evaluate("document.querySelectorAll('.composer-dock .message-quote').length"),
    3,
  );
  assert.match(
    await evaluate(
      "document.querySelectorAll('.composer-dock .message-quote blockquote')[1].textContent",
    ),
    /const answer = 42;/,
  );
  assert.match(
    await evaluate(
      "document.querySelectorAll('.composer-dock .message-quote blockquote')[2].textContent",
    ),
    /\$E=mc\^2\$/,
  );
  await click(".composer-dock .message-quote:first-of-type button");
  assert.equal(
    await evaluate("document.querySelectorAll('.composer-dock .message-quote').length"),
    2,
  );
  await screenshot("quotes-expanded-dark.png");
  await assertMessageQuotes(evaluate, ".main-pane .composer-dock .message-quotes");
  await evaluate("document.querySelector('.main-pane .composer-dock .message-quote-source').focus()");
  await waitFor(
    () => evaluate("[...document.querySelectorAll('[role=tooltip]')].some(e=>/会话 .+消息 /.test(e.textContent))"),
    5000, "reference source available through keyboard focus",
  );
  assert.ok(await evaluate("[...document.querySelectorAll('[role=tooltip]')].some(e=>e.textContent.includes(" + JSON.stringify(parent.id) + "))"));
  await screenshot("quote-source-dark.png");
  await type(mainInput, "解释引用");
  await key("Enter", 13);
  await waitFor(() => requests.length >= 2, 30000, "quoted provider input");
  assert.match(JSON.stringify(requests.at(-1).messages), /Quoted conversation excerpts/);
  const detail = await invoke("sessionGet", parent.id);
  assert.ok(detail.session.messages.some((row) => row.role === "user" && row.quotes?.length === 2));
  await waitFor(
    async () => !(await invoke("agentGetStatus", parent.id)).status.isRunning,
    15000,
    "parent idle",
  );
  const quotedId = detail.session.messages.find(
    (row) => row.role === "user" && row.quotes?.length === 2,
  ).id;
  await evaluate(
    "[...document.querySelectorAll('[data-message-id=\"" +
      quotedId +
      "\"] button')].find(e=>/编辑|Edit/.test(e.getAttribute('aria-label')||'')).click()",
  );
  await waitFor(
    () => evaluate("!!document.querySelector('.message-edit-input')"),
    5000,
    "quoted message edit",
  );
  await click(".message-edit-input");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await send("Input.insertText", { text: "EDITED_QUOTED_QUESTION" });
  await click(".message-edit-submit");
  await waitFor(
    () => requests.some((body) => JSON.stringify(body).includes("EDITED_QUOTED_QUESTION")),
    20000,
    "edited quote sent",
  );
  assert.match(JSON.stringify(requests.at(-1)), /Quoted conversation excerpts/);
  await waitFor(
    async () => !(await invoke("agentGetStatus", parent.id)).status.isRunning,
    15000,
    "edited parent idle",
  );
  await type(mainInput, "HOLD_PARENT");
  await key("Enter", 13);
  await waitFor(() => held.size === 1, 20000, "parent held stream");
  await select("[data-quote-body] p");
  await click(".selection-actions button:first-child");
  await type(mainInput, "QUEUED_QUOTE");
  await key("Enter", 13);
  await waitFor(
    () => evaluate("!!document.querySelector('.composer-queued-prompt-edit:not(:disabled)')"),
    10000,
    "quote queued",
  );
  await click(".composer-queued-prompt-edit");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.composer-input').innerText.includes('QUEUED_QUOTE') && !!document.querySelector('.composer-dock [data-message-quotes]')",
      ),
    5000,
    "queued quote restored",
  );
  await click(mainInput);
  await key("Enter", 13);
  await waitFor(
    () => evaluate("!!document.querySelector('.composer-queued-prompt-remove:not(:disabled)')"),
    10000,
    "quote requeued",
  );
  await click(".composer-queued-prompt-remove");
  await select("[data-quote-body] pre");
  await click(".selection-actions button:last-child");
  await waitFor(
    () => evaluate("!!document.querySelector('.side-chat-pane .composer-input')"),
    20000,
    "side pane ready",
  );
  const sideId = await evaluate("document.querySelector('[data-side-chat]').dataset.sideChat");
  const side = await invoke("sessionGet", sideId);
  assert.equal(side.session.modelId, parent.modelId);
  assert.equal(side.session.thinkingLevel, parent.thinkingLevel);
  await type(sideInput, "SIDE_WRITE");
  await select("[data-quote-body] p");
  await click(".selection-actions button:last-child");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.side-chat-pane .message-quotes summary')?.textContent.includes('2')",
      ),
    10000,
    "side reuse adds quotes",
  );
  assert.equal(
    await evaluate("document.querySelector('[data-side-chat]').dataset.sideChat"),
    sideId,
  );
  assert.equal(
    await evaluate("document.querySelector('.side-chat-pane .composer-input').innerText"),
    "SIDE_WRITE",
  );
  await click(".side-chat-pane .composer-dock .message-quotes summary");
  await assertMessageQuotes(evaluate, ".side-chat-pane .composer-dock .message-quotes");
  await screenshot("side-quotes-expanded-dark.png");
  await click(".side-chat-pane .composer-dock .message-quotes summary");
  await key("Enter", 13);
  assert.ok(await evaluate("document.querySelector('.side-chat-pane .composer-dock .message-quotes').open"),
    "reference disclosure opens with the keyboard");
  await click(".side-chat-pane .composer-dock .message-quotes summary");
  await click(".work-panel-tab-close");
  await waitFor(
    () => evaluate("!!document.querySelector('[role=alertdialog]')"),
    5000,
    "draft close confirmation",
  );
  await click("[role=alertdialog] button:first-child");
  await click(sideInput);
  await key("Enter", 13);
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.side-chat-pane')?.innerText.includes('side-chat-proof.txt')",
      ),
    30000,
    "side tool approval",
  );
  await screenshot("side-approval-dark.png");
  await click(".side-chat-pane .permission-card-actions button:last-child");
  await waitFor(() => existsSync(join(project, "side-chat-proof.txt")), 20000, "shared file write");
  await waitFor(
    () => evaluate("document.querySelector('.side-chat-pane')?.innerText.includes('SIDE_DONE')"),
    30000,
    "side completed reply",
  );
  assert.equal(held.size, 1, "side send did not interrupt parent");
  const sideRequest = requests.find((body) =>
    content(body.messages?.findLast((m) => m.role === "user")?.content).includes("SIDE_WRITE"),
  );
  assert.match(JSON.stringify(sideRequest.messages), /最近完整回复/);
  assert.doesNotMatch(JSON.stringify(sideRequest.messages), /主对话正在运行/);
  const mainAfter = await invoke("sessionGet", parent.id);
  assert.ok(
    mainAfter.session.messages.every(
      (row) => !row.content.includes("SIDE_WRITE") && !row.content.includes("SIDE_DONE"),
    ),
  );
  const childAfter = await invoke("sessionGet", sideId);
  assert.ok(
    childAfter.session.messages.every((row) => !row.content.includes("INITIAL_CONTEXT")),
    "parent rows not copied into child",
  );
  await screenshot("side-wide-dark.png");
  await assertSideChatLayout(evaluate, "docked dark");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await click(".work-panel-resize");
  await key("End", 35);
  await waitFor(
    () => evaluate("document.querySelector('.side-chat-pane').getBoundingClientRect().width > 640"),
    5000, "expanded side pane",
  );
  await screenshot("side-expanded-dark.png");
  await assertSideChatLayout(evaluate, "expanded dark");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.side-chat-pane .composer-model-thinking-model')).display === 'none'"), false);
  await type(sideInput, "Draft line one\nDraft line two\nDraft line three\nDraft line four\nDraft line five");
  await screenshot("side-multiline-dark.png");
  await assertSideChatLayout(evaluate, "multiline draft");
  await send("Input.dispatchKeyEvent", {type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2});
  await send("Input.dispatchKeyEvent", {type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2});
  await key("Backspace", 8);
  await click(".work-panel-resize");
  await key("Home", 36);
  await send("Emulation.clearDeviceMetricsOverride");
  await click(".side-chat-pane .composer-model-thinking-chip");
  await click(".composer-menu-entry[aria-haspopup=menu]");
  await evaluate(
    "[...document.querySelectorAll('.composer-menu-entry')].find(e=>/其他模型|Other models/.test(e.textContent))?.click()",
  );
  await waitFor(
    () =>
      evaluate("!!document.querySelector('.composer-model-option[title=\"fixture-reasoning\"]')"),
    5000,
    "side model choice",
  );
  await click('.composer-model-option[title="fixture-reasoning"]');
  await waitFor(
    async () => (await invoke("sessionGet", sideId)).session.modelId === "fixture-reasoning",
    10000,
    "side model saved",
  );
  await waitFor(
    () => evaluate("!!document.querySelector('.composer-thinking-tick[title=\"high\"]')"),
    5000,
    "reasoning options",
  );
  await click('.composer-thinking-tick[title="high"]');
  await waitFor(
    async () => (await invoke("sessionGet", sideId)).session.thinkingLevel === "high",
    10000,
    "side reasoning saved",
  );
  await key("Escape", 27);
  assert.equal((await invoke("sessionGet", parent.id)).session.modelId, parent.modelId);
  assert.equal((await invoke("sessionGet", parent.id)).session.thinkingLevel, parent.thinkingLevel);
  assert.match(
    await evaluate(
      "document.querySelector('.side-chat-pane .composer-model-thinking-chip').getAttribute('aria-label')",
    ),
    /fixture-reasoning.*high/,
    "compact model chip preserves the selected model and reasoning in its accessible name",
  );
  await screenshot("side-model-reasoning.png");
  await type(sideInput, "/plan-mode ");
  await click(".side-chat-pane .send-btn");
  await waitFor(
    async () => (await invoke("sessionGet", sideId)).session.mode === "plan",
    10000,
    "side-only plan command",
  );
  assert.equal((await invoke("sessionGet", parent.id)).session.mode, "agent");
  await type(sideInput, "/agent-mode ");
  await click(".side-chat-pane .send-btn");
  await waitFor(
    async () => (await invoke("sessionGet", sideId)).session.mode === "agent",
    10000,
    "side-only agent command",
  );
  await select("[data-quote-body] p");
  await click(".selection-actions button:last-child");
  await type(sideInput, "NO_OUTPUT_SIDE");
  await key("Enter", 13);
  await waitFor(() => held.size === 2, 20000, "side waiting without output");
  await click(".side-chat-pane .stop-btn");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.side-chat-pane .composer-input')?.innerText.includes('NO_OUTPUT_SIDE') && !!document.querySelector('.side-chat-pane .message-quotes')",
      ),
    15000,
    "side smart stop restores quote and draft",
  );
  await click(sideInput);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await send("Input.insertText", { text: "SIDE_RESEND" });
  await key("Enter", 13);
  await waitFor(
    () =>
      requests.some((body) =>
        content(body.messages?.findLast((m) => m.role === "user")?.content).includes("SIDE_RESEND"),
      ),
    20000,
    "side resend after stop",
  );
  const resend = requests.find((body) =>
    content(body.messages?.findLast((m) => m.role === "user")?.content).includes("SIDE_RESEND"),
  );
  assert.match(JSON.stringify(resend.messages), /最近完整回复/);
  assert.match(JSON.stringify(resend.messages), /SIDE_DONE/);
  assert.doesNotMatch(JSON.stringify(resend.messages), /NO_OUTPUT_SIDE/);
  assert.equal(resend.model, "fixture-reasoning");
  await waitFor(
    async () => !(await invoke("agentGetStatus", sideId)).status.isRunning,
    15000,
    "side resend idle",
  );
  const childResend = (await invoke("sessionGet", sideId)).session.messages.find(
    (row) => row.role === "user" && row.content === "SIDE_RESEND",
  );
  // A real Plan turn rebuilds the runtime. Earlier child IDs must remain editable.
  await type(sideInput, "/plan-mode ");
  await click(".side-chat-pane .send-btn");
  await waitFor(
    async () => (await invoke("sessionGet", sideId)).session.mode === "plan",
    10000,
    "side rebuild plan mode",
  );
  await type(sideInput, "SIDE_PLAN_REBUILD");
  await key("Enter", 13);
  await waitFor(
    async () =>
      requests.some((body) =>
        content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
          "SIDE_PLAN_REBUILD",
        ),
      ) && !(await invoke("agentGetStatus", sideId)).status.isRunning,
    20000,
    "side plan turn completed",
  );
  await type(sideInput, "/agent-mode ");
  await click(".side-chat-pane .send-btn");
  await waitFor(
    async () => (await invoke("sessionGet", sideId)).session.mode === "agent",
    10000,
    "side returns to agent mode",
  );
  await evaluate(
    "[...document.querySelectorAll('.side-chat-pane [data-message-id=\"" +
      childResend.id +
      "\"] button')].find(e=>/编辑|Edit/.test(e.getAttribute('aria-label')||'')).click()",
  );
  await waitFor(
    () => evaluate("!!document.querySelector('.side-chat-pane .message-edit-input')"),
    5000,
    "side quoted edit",
  );
  await click(".side-chat-pane .message-edit-input");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await send("Input.insertText", { text: "SIDE_EDITED_QUESTION" });
  await click(".side-chat-pane .message-edit-submit");
  await waitFor(
    () =>
      requests.some((body) =>
        content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
          "SIDE_EDITED_QUESTION",
        ),
      ),
    20000,
    "side edited request",
  );
  const editedSide = requests.find((body) =>
    content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
      "SIDE_EDITED_QUESTION",
    ),
  );
  assert.match(JSON.stringify(editedSide.messages), /Quoted conversation excerpts/);
  assert.match(JSON.stringify(editedSide.messages), /SIDE_DONE/);
  assert.doesNotMatch(JSON.stringify(editedSide.messages), /SIDE_RESEND/);
  assert.doesNotMatch(JSON.stringify(editedSide.messages), /SIDE_PLAN_REBUILD/);
  await waitFor(
    async () => !(await invoke("agentGetStatus", sideId)).status.isRunning,
    15000,
    "side edit idle",
  );
  const editedReplyId = (await invoke("sessionGet", sideId)).session.messages
    .findLast((message) => message.role === "assistant").id;
  const retryTarget = "[...document.querySelector('.side-chat-pane [data-message-id=\"" +
    editedReplyId + "\"]')?.closest('.assistant-turn')?.querySelectorAll('button') ?? []]" +
    ".find(e=>/^(重新生成|重试|Regenerate|Retry)$/.test(e.getAttribute('aria-label')||''))";
  await waitFor(() => evaluate("!!(" + retryTarget + ")"), 10000, "edited reply retry control rendered");
  const beforeRetry = requests.length;
  await evaluate("(" + retryTarget + ").click()");
  await waitFor(() => requests.length > beforeRetry, 20000, "side regenerate");
  assert.match(JSON.stringify(requests.at(-1).messages), /SIDE_EDITED_QUESTION/);
  assert.match(JSON.stringify(requests.at(-1).messages), /SIDE_DONE/);
  await waitFor(
    async () => !(await invoke("agentGetStatus", sideId)).status.isRunning,
    15000,
    "side retry idle",
  );
  assert.ok(
    (await invoke("sessionGet", parent.id)).session.messages.every(
      (row) => !row.content.includes("SIDE_EDITED_QUESTION"),
    ),
  );
  await type(sideInput, "PRESERVED_SIDE_DRAFT");
  await click(".app-work-panel-toggle");
  await waitFor(
    () => evaluate("!document.querySelector('.side-chat-pane')"),
    10000,
    "collapse hides side",
  );
  await click(".app-work-panel-toggle");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.side-chat-pane .composer-input')?.innerText.includes('PRESERVED_SIDE_DRAFT')",
      ),
    10000,
    "expand restores side",
  );
  await click(".work-panel-new-tab");
  await waitFor(
    () => evaluate("!!document.querySelector('.work-panel-launcher')"),
    5000,
    "switch work panel tab",
  );
  await click('[data-work-panel-tab-id="side-chat:' + sideId + '"] .work-panel-tab-button');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.side-chat-pane .composer-input')?.innerText.includes('PRESERVED_SIDE_DRAFT')",
      ),
    10000,
    "side tab restores draft",
  );
  await evaluate("document.querySelector('.sidebar-session-group-add').click()");
  await waitFor(
    () => evaluate("!document.querySelector('.side-chat-pane')"),
    10000,
    "new main hides side",
  );
  await click('[data-sidebar-session-row="' + parent.id + '"]');
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.side-chat-pane .composer-input')?.innerText.includes('PRESERVED_SIDE_DRAFT')",
      ),
    10000,
    "return restores child draft",
  );
  await waitFor(
    () => evaluate("document.querySelector('.side-chat-pane')?.innerText.includes('SIDE_DONE')"),
    10000,
    "new main navigation preserves child transcript",
  );
  await click(sideInput);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2,
  });
  await key("Backspace", 8);
  assert.ok(
    !(await invoke("sessionList")).sessions.some((session) => session.id === sideId),
    "side hidden from history",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 680,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    () => evaluate("!!document.querySelector('.is-side-chat-drawer')"),
    5000,
    "narrow overlay",
  );
  await screenshot("side-narrow-dark.png");
  await assertSideChatLayout(evaluate, "drawer dark");
  await send("Emulation.clearDeviceMetricsOverride");
  await click('[data-nav="settings"]');
  await waitFor(
    () => evaluate("!!document.querySelector('.settings-theme-trigger')"),
    10000,
    "settings theme control",
  );
  await click(".settings-theme-trigger");
  await evaluate(
    "[...document.querySelectorAll('.settings-theme-option')].find(e=>/浅色|亮色|Light/.test(e.textContent)).click()",
  );
  await waitFor(
    () => evaluate("document.documentElement.dataset.theme === 'light'"),
    10000,
    "light theme applied",
  );
  await click('[data-nav="back-to-app"]');
  await waitFor(
    () => evaluate("!!document.querySelector('.side-chat-pane')"),
    10000,
    "side restored after settings navigation",
  );
  await waitFor(
    () => evaluate("document.querySelector('.side-chat-pane')?.innerText.includes('SIDE_DONE')"),
    10000,
    "settings refresh preserves child transcript",
  );
  await select(".main-pane [data-quote-body] p");
  await assertSelectionActions(evaluate);
  await screenshot("selection-light.png");
  await click(".selection-actions button:last-child");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 680,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot("side-narrow-light.png");
  await assertSideChatLayout(evaluate, "drawer light");
  await click(".side-chat-pane .composer-dock .message-quotes summary");
  await assertMessageQuotes(evaluate, ".side-chat-pane .composer-dock .message-quotes");
  await screenshot("side-quotes-narrow-light.png");
  await evaluate("document.querySelector('.side-chat-pane .composer-dock .message-quote-source').focus()");
  await waitFor(
    () => evaluate("[...document.querySelectorAll('[role=tooltip]')].some(e=>/会话 .+消息 /.test(e.textContent))"),
    5000, "side reference source tooltip",
  );
  await key("Tab", 9);
  await key("Enter", 13);
  await waitFor(
    () => evaluate("!document.querySelector('.side-chat-pane .composer-dock .message-quotes')"),
    5000, "side reference removed using accessible icon control",
  );
  await send("Emulation.clearDeviceMetricsOverride");
  writeFileSync(join(project, "side-watch.mjs"), 'console.log("side watcher ready"); setInterval(() => {}, 1000);\n');
  await invoke("sessionConfigure", sideId, { mode: "agent", permissionMode: "auto" });
  await type(sideInput, "SIDE_BACKGROUND");
  await key("Enter", 13);
  await waitFor(async () => (await invoke("backgroundTasksList")).tasks.some((task) => task.sessionId === sideId && task.state === "running"), 20000, "side background command started");
  await waitFor(async () => !(await invoke("agentGetStatus", sideId)).status.isRunning, 15000, "side background turn finished");
  await waitFor(() => evaluate("!!document.querySelector('.side-chat-pane .background-tasks-bar')"), 10000, "side task bar visible");
  assert.equal(await evaluate("document.querySelectorAll('.main-pane .background-tasks-bar').length"), 0, "side task does not appear in the parent composer");
  await screenshot("side-background-task.png");
  await click('[data-work-panel-tab-id="side-chat:' + sideId + '"] .work-panel-tab-close');
  await waitFor(() => evaluate("!!document.querySelector('[role=alertdialog]')"), 5000, "background-only close confirmation");
  await click("[role=alertdialog] button:first-child");
  assert.ok((await invoke("backgroundTasksList")).tasks.some((task) => task.sessionId === sideId && task.state === "running"), "cancel close keeps the background command running");
  await type(sideInput, "HOLD_SIDE");
  await key("Enter", 13);
  await waitFor(() => held.size === 2, 20000, "both streams running");
  await type(sideInput, "NEVER_RUN_CLOSED_QUEUE");
  await key("Enter", 13);
  await waitFor(
    () => evaluate("!!document.querySelector('.side-chat-pane .composer-queued-prompt-remove')"),
    10000,
    "child queue waiting",
  );
  await click('[data-work-panel-tab-id="side-chat:' + sideId + '"] .work-panel-tab-close');
  await waitFor(
    () => evaluate("!!document.querySelector('[role=alertdialog]')"),
    5000,
    "close confirmation",
  );
  await screenshot("side-close-confirm.png");
  await click("[role=alertdialog] button:last-child");
  await waitFor(() => evaluate("!document.querySelector('.side-chat-pane')"), 30000, "side closed");
  assert.equal(
    readFileSync(join(project, "side-chat-proof.txt"), "utf8"),
    "side chat wrote this\n",
  );
  await waitFor(() => held.size === 1, 5000, "side stream cancelled");
  assert.equal((await invoke("sessionGet", sideId)).session, null);
  assert.ok((await invoke("backgroundTasksList")).tasks.filter((task) => task.sessionId === sideId).every((task) => task.state !== "running"), "closing the side chat stops its detached commands");
  assert.ok(!requests.some((body) => JSON.stringify(body).includes("NEVER_RUN_CLOSED_QUEUE")));
  console.log("PASS quotes, inherited complete context, tools/approval, narrow overlay and close");
  await select("[data-quote-body] p");
  await click(".selection-actions button:first-child");
  await type(mainInput, "STEER_QUOTED_QUESTION");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 1,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 1,
  });
  await waitFor(
    async () =>
      (await invoke("sessionGet", parent.id)).session.messages.some(
        (row) => row.content === "STEER_QUOTED_QUESTION" && row.quotes?.length === 1,
      ),
    10000,
    "quoted immediate steering accepted",
  );
  await select("[data-quote-body] pre");
  await click(".selection-actions button:first-child");
  await type(mainInput, "QUEUED_DELIVERY_QUESTION");
  await key("Enter", 13);
  await waitFor(
    () => evaluate("!!document.querySelector('.composer-queued-prompt-remove')"),
    10000,
    "quoted delivery queued",
  );
  finishParent();
  await waitFor(
    () =>
      requests.some((body) =>
        content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
          "STEER_QUOTED_QUESTION",
        ),
      ),
    20000,
    "steered provider request",
  );
  const steered = requests.find((body) =>
    content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
      "STEER_QUOTED_QUESTION",
    ),
  );
  assert.match(
    content(steered.messages.findLast((m) => m.role === "user").content),
    /Quoted conversation excerpts/,
  );
  await waitFor(
    () =>
      requests.some((body) =>
        content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
          "QUEUED_DELIVERY_QUESTION",
        ),
      ),
    20000,
    "queued quote reaches provider",
  );
  const delivered = requests.find((body) =>
    content(body.messages?.findLast((m) => m.role === "user")?.content).includes(
      "QUEUED_DELIVERY_QUESTION",
    ),
  );
  assert.match(
    content(delivered.messages.findLast((m) => m.role === "user").content),
    /Quoted conversation excerpts/,
  );
  assert.ok(
    (await invoke("sessionGet", parent.id)).session.messages.some(
      (row) => row.content === "QUEUED_DELIVERY_QUESTION" && row.quotes?.length === 1,
    ),
  );
  await waitFor(
    async () => !(await invoke("agentGetStatus", parent.id)).status.isRunning && held.size === 0,
    15000,
    "steered parent idle",
  );
  console.log("PASS quoted immediate steering and side edit after mode reconstruction");
  await invoke("agentAbort", { sessionId: parent.id });
  await select("[data-quote-body] p");
  await click(".selection-actions button:last-child");
  await waitFor(
    () => evaluate("!!document.querySelector('[data-side-chat]')"),
    15000,
    "side approval close fixture",
  );
  const approvalSide = await evaluate(
    "document.querySelector('[data-side-chat]').dataset.sideChat",
  );
  await type(sideInput, "SIDE_DENIED_WRITE");
  await key("Enter", 13);
  await waitFor(
    () => evaluate("!!document.querySelector('.side-chat-pane .permission-card')"),
    20000,
    "pending side approval",
  );
  await click('[data-work-panel-tab-id="side-chat:' + approvalSide + '"] .work-panel-tab-close');
  await waitFor(
    () => evaluate("!!document.querySelector('[role=alertdialog]')"),
    5000,
    "approval close confirmation",
  );
  await click("[role=alertdialog] button:last-child");
  await waitFor(
    () => evaluate("!document.querySelector('.side-chat-pane')"),
    20000,
    "approval side closed",
  );
  assert.equal((await invoke("sessionGet", approvalSide)).session, null);
  assert.ok(
    !existsSync(join(project, "must-not-exist.txt")),
    "closing approval never authorizes its write",
  );

  await select("[data-quote-body] p");
  await click(".selection-actions button:last-child");
  await waitFor(
    () => evaluate("!!document.querySelector('[data-side-chat]')"),
    15000,
    "delegate close fixture",
  );
  const delegateSide = await evaluate(
    "document.querySelector('[data-side-chat]').dataset.sideChat",
  );
  await type(sideInput, "SIDE_DELEGATE");
  await key("Enter", 13);
  await waitFor(() => held.size > 0, 30000, "side delegate running");
  await screenshot("side-delegate-running.png");
  await click('[data-work-panel-tab-id="side-chat:' + delegateSide + '"] .work-panel-tab-close');
  await waitFor(
    () => evaluate("!!document.querySelector('[role=alertdialog]')"),
    5000,
    "delegate close confirmation",
  );
  await click("[role=alertdialog] button:last-child");
  await waitFor(
    async () => (await evaluate("!document.querySelector('.side-chat-pane')")) && held.size === 0,
    25000,
    "delegate cancelled on close",
  );
  assert.equal((await invoke("sessionGet", delegateSide)).session, null);
  console.log("PASS pending approval and delegated task cancellation");
  await select("[data-quote-body] p");
  await click(".selection-actions button:last-child");
  await waitFor(
    () => evaluate("!!document.querySelector('[data-side-chat]')"),
    15000,
    "fresh side for restart",
  );
  const staleId = await evaluate("document.querySelector('[data-side-chat]').dataset.sideChat");
  await type(sideInput, "SIDE_BEFORE_RESTART");
  await key("Enter", 13);
  await waitFor(
    async () =>
      !(await invoke("agentGetStatus", staleId)).status.isRunning &&
      requests.some((body) => JSON.stringify(body).includes("SIDE_BEFORE_RESTART")),
    20000,
    "restart fixture settled",
  );
  const beforeRestart = requests.length;
  ws.close();
  child.kill();
  await closed;
  child = launch();
  closed = once(child, "close");
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      log += data;
    });
  await waitFor(
    async () => {
      try {
        target = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).find(
          (e) =>
            e.type === "page" && e.url.includes("index.html") && !e.url.includes("plugin-launcher"),
        );
        return !!target;
      } catch {
        return false;
      }
    },
    45000,
    "restarted target",
  );
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, "open");
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data),
      entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
  };
  await waitFor(
    () =>
      evaluate(
        "!!document.querySelector('.composer-input') && !document.querySelector('.startup-splash')",
      ),
    45000,
    "restart ready",
  );
  assert.equal((await invoke("sessionGet", staleId)).session, null);
  assert.ok(
    !(await invoke("sessionList")).sessions.some((session) => session.id.startsWith("side-")),
  );
  assert.equal(requests.length, beforeRestart, "restart does not replay tools or prompts");
  assert.equal(
    readFileSync(join(project, "side-chat-proof.txt"), "utf8"),
    "side chat wrote this\n",
  );
  console.log("PASS restart recycles stale child records without restoring or replaying work");
  await evaluate("localStorage.setItem('pi.desktop.workPanel', JSON.stringify({width:80}))");
  await send("Page.reload");
  await waitFor(
    () =>
      evaluate(
      "!!document.querySelector('.composer-input') && !document.querySelector('.startup-splash')",
      ),
    30000,
    "compact preference reload",
  );
  await click('[data-sidebar-session-row="' + parent.id + '"]');
  await waitFor(() => evaluate("!!document.querySelector('[data-quote-body] p')"), 10000, "compact parent opened");
  await waitFor(() => evaluate("[...document.querySelectorAll('.thread-wrap')].filter(e=>e.getClientRects().length).every(e=>e.dataset.transcriptSettling!=='true')"), 15000, "compact transcript settled");
  await screenshot("compact-parent-ready.png");
  await select("[data-quote-body] p");
  await click(".selection-actions button:last-child");
  await waitFor(
    () => evaluate("!!document.querySelector('[data-side-chat]')"),
    15000,
    "side with old compact preference",
  );
  const compactSide = await evaluate("document.querySelector('[data-side-chat]').dataset.sideChat");
  await screenshot("side-compact-preference.png");
  assert.ok(
    await evaluate("document.querySelector('.work-panel').getBoundingClientRect().width >= 360"),
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('pi.desktop.workPanel')).width"),
    80,
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 680,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    () => evaluate("!!document.querySelector('.is-side-chat-drawer')"),
    5000,
    "compact preference drawer",
  );
  await send("Emulation.clearDeviceMetricsOverride");
  await waitFor(
    () =>
      evaluate(
        "!document.querySelector('.is-side-chat-drawer') && document.querySelector('.work-panel').getBoundingClientRect().width >= 360",
      ),
    5000,
    "compact preference recovered",
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('pi.desktop.workPanel')).width"),
    80,
  );
  await click('[data-work-panel-tab-id="side-chat:' + compactSide + '"] .work-panel-tab-close');
  await waitFor(
    () => evaluate("!!document.querySelector('[role=alertdialog]')"),
    5000,
    "compact child draft confirmation",
  );
  await click("[role=alertdialog] button:last-child");
  await waitFor(
    () => evaluate("!document.querySelector('[data-side-chat]')"),
    15000,
    "compact child closed",
  );
  console.log("PASS old compact preference recovers without persisting temporary width");
} catch (error) {
  await failureEvidence?.();
  throw error;
} finally {
  writeFileSync(join(scratch, "requests.json"), JSON.stringify(requests, null, 2));
  ws?.close();
  for (const res of held) res.end();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (child.exitCode === null) child.kill();
  await closed;
  writeFileSync(join(scratch, "desktop.log"), log);
  console.log("Retained isolated evidence: " + scratch);
}
