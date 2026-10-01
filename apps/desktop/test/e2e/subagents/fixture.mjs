import { createServer, request } from "node:http";
import { randomUUID } from "node:crypto";
import { imageFixture } from "../images/fixture.mjs";

/** MC authorization/catalog and controlled streamed workers. No paid calls. */
export async function subagentFixture() {
  const mc = await imageFixture();
  const model = id => ({ id, modes: ["text"], supported_endpoint_types: ["openai"] });
  mc.catalog.groups = ["Channel A", "中文 Channel B"].map(id => ({ id, name: id, ratio: 1, dynamic_billing: false, models: [model("gpt-6-astra"), model("grok-4.7")] }));
  const calls = [], held = new Map(), controls = { keys: [], resume: undefined, failChild: false, immediate: false };
  const server = createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions") {
      const proxy = request(new URL(req.url, mc.origin), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      proxy.on("error", () => res.destroy()); req.pipe(proxy); res.on("close", () => proxy.destroy()); return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const last = body.messages.findLastIndex(message => message.role === "user");
    const turn = body.messages.slice(last), prompt = JSON.stringify(turn[0]);
    const parent = body.tools?.some(tool => tool.function.name === "Task");
    const worker = !parent && body.messages.some(message => JSON.stringify(message).includes("WORKER_"));
    const tools = turn.filter(message => message.role === "tool");
    calls.push({ body, prompt, parent, worker, group: decodeURIComponent(req.headers["x-mirrorcoding-group"] ?? ""), closed: false });
    const call = calls.at(-1);
    res.on("close", () => { call.closed = true; held.delete(call); });
    if (worker && controls.failChild) {
      controls.failChild = false;
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "Controlled channel rejection", code: "fixture_rejected" } })); return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (delta, finish_reason = null) => res.write("data: " + JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
    const finish = text => { if (!res.destroyed) { emit({ content: text }); emit({}, "stop"); res.end("data: [DONE]\n\n"); } };
    emit({ role: "assistant" });
    if (parent && !tools.length && /CONTROL_(PARALLEL|REPORT|FAIL|RESUME|YIELD|RAPID)/.test(prompt)) {
      const args = prompt.includes("CONTROL_RESUME")
        ? [{ agent: "explorer", task: "Continue the earlier worker inspection.", resume: controls.resume }]
        : (/CONTROL_(PARALLEL|YIELD|RAPID)/.test(prompt) ? controls.keys : controls.keys.slice(0, 1)).map((key, index) => ({ agent: "explorer", model: key, description: "Worker " + (index + 1), task: "WORKER_" + index + ": inspect the assigned module and report only your results." }));
      emit({ tool_calls: args.map((args, index) => ({ index, id: randomUUID(), type: "function", function: { name: "Task", arguments: JSON.stringify(args) } })) });
      emit({}, "tool_calls"); res.end("data: [DONE]\n\n"); return;
    }
    if (worker && controls.immediate) { finish("CONTROLLED_WORKER_REPORT"); return; }
    if (worker || (prompt.includes("CONTROL_PARALLEL") && tools.length)) {
      emit({ content: parent ? "Independent parent work in progress." : "Worker progress is visible." });
      held.set(call, () => finish(parent ? "Parent finished." : "CONTROLLED_WORKER_REPORT")); return;
    }
    finish(prompt.includes("Subagent reports ready:") ? "Parent received the internal worker report." : "Background work submitted.");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: "http://127.0.0.1:" + server.address().port, calls, controls,
    releaseWorkers(group) { for (const [call, finish] of held) if (call.worker && (group === undefined || call.group === group)) { held.delete(call); finish(); } },
    close() { for (const [call, finish] of held) { held.delete(call); finish(); } server.closeAllConnections(); server.close(); mc.close(); },
  };
}
