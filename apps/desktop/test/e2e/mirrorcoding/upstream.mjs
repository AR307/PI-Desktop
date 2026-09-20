import { createServer } from "node:http";
import { resolve } from "node:path";

/** Controlled upstream behind the real local MirrorCoding gateway. */
export async function startUpstream() {
  const calls = [];
  let mode = "normal";
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    calls.push({ path: request.url, body, authentication: request.headers.authorization === "Bearer local-fixture", hasGroupHeader: Boolean(request.headers["x-mirrorcoding-group"]) });
    if (mode === "429" || mode === "503") {
      const status = Number(mode); mode = "normal";
      response.writeHead(status, { "content-type": "application/json", "retry-after": "1" });
      response.end(JSON.stringify({ error: { message: "Controlled temporary failure", type: "server_error" } })); return;
    }
    if (mode === "hold") {
      return;
    }
    const text = "MirrorCoding local reply: connection and selected group verified.";
    const usage = { input_tokens: 20, output_tokens: 12, total_tokens: 32, input_tokens_details: { cached_tokens: 0 } };
    const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
    const data = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
    if (mode === "tool" || mode === "delegate") {
      const toolName = mode === "delegate" ? "Task" : "Read";
      const args = mode === "delegate"
        ? { agent: "explorer", task: "Reply with the local acceptance message; do not call tools.", description: "Verify inherited MirrorCoding model" }
        : { path: resolve(import.meta.dirname, "../../../package.json"), limit: 2 };
      mode = "normal";
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (request.url.startsWith("/v1/responses")) {
        const item = { type: "function_call", id: "fc_fixture", call_id: "call_fixture", name: toolName, arguments: JSON.stringify(args), status: "completed" };
        event("response.created", { type: "response.created", response: { id: "resp_tool", status: "in_progress", output: [] } });
        event("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } });
        event("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments });
        event("response.output_item.done", { type: "response.output_item.done", output_index: 0, item });
        event("response.completed", { type: "response.completed", response: { id: "resp_tool", model: body.model, status: "completed", output: [item], usage } });
      } else if (request.url.startsWith("/v1/messages")) {
        event("message_start", { type: "message_start", message: { id: "msg_tool", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 1 } } });
        event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_fixture", name: toolName, input: {} } });
        event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } });
        event("content_block_stop", { type: "content_block_stop", index: 0 });
        event("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } });
        event("message_stop", { type: "message_stop" });
      } else if (request.url.includes("GenerateContent")) {
        data({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: toolName, args } }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12, totalTokenCount: 32 } });
      } else {
        const chunk = (delta, finish_reason = null) => ({ id: "chat_tool", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] });
        data(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }] }));
        data(chunk({}, "tool_calls")); response.write("data: [DONE]\n\n");
      }
      response.end(); return;
    }
    if (request.url.startsWith("/v1/responses")) {
      const message = { type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
      const result = { id: "resp_fixture", object: "response", status: "completed", model: body.model, output: [message], usage };
      if (!body.stream) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result)); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const value of [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
        { type: "response.content_part.added", item_id: message.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
        { type: "response.output_text.delta", item_id: message.id, output_index: 0, content_index: 0, delta: text },
      ]) event(value.type, value);
      if (mode === "interrupt") { setTimeout(() => response.destroy(), 150); return; }
      event("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: message });
      event("response.completed", { type: "response.completed", response: result });
    } else if (request.url.startsWith("/v1/messages")) {
      const result = { id: "msg_fixture", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 12 } };
      if (!body.stream) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result)); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      event("message_start", { type: "message_start", message: { ...result, content: [], stop_reason: null } });
      event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
      if (mode === "interrupt") { setTimeout(() => response.destroy(), 150); return; }
      event("content_block_stop", { type: "content_block_stop", index: 0 });
      event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } });
      event("message_stop", { type: "message_stop" });
    } else if (request.url.includes("generateContent") || request.url.includes("streamGenerateContent")) {
      const result = { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12, totalTokenCount: 32 } };
      if (!request.url.includes("streamGenerateContent")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result)); return; }
      response.writeHead(200, { "content-type": "text/event-stream" }); data(result);
    } else {
      const chunk = (delta, finish_reason = null) => ({ id: "chat_fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] });
      if (!body.stream) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ id: "chat_fixture", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      data(chunk({ role: "assistant", content: "" })); data(chunk({ content: text }));
      if (mode === "interrupt") { setTimeout(() => response.destroy(), 150); return; }
      data(chunk({}, "stop")); response.write("data: [DONE]\n\n");
    }
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  return { server, calls, port: server.address().port, setMode(value) { mode = value; } };
}
