import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

// A visible test image, generated locally. No external or paid image service.
function png(tint = 0) {
  const crc = (bytes) => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name), n = Buffer.alloc(4), tail = Buffer.alloc(4); n.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([n, type, data, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(400); header.writeUInt32BE(240, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(240 * 1201);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 400; x++) { const o = y * 1201 + 1 + x * 3; pixels[o] = 40 + tint * 30 + x / 2; pixels[o + 1] = 80 + y / 2; pixels[o + 2] = 160; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

export async function imageFixture() {
  const bytes = png(), calls = [], downloads = [], chats = [];
  const control = { hold: false, imageStatus: 200, downloadsFail: false, downloadsHold: false, rejectOnce: false, empty: false, removeAuto: false, offline: false, refreshes: 0, aborted: 0, revocations: 0 };
  const image = { generation_path: "/v1/images/generations", reference_path: "/v1/images/edits", sizes: ["1024x1024", "1536x1024"], qualities: ["high", "low"], max_count: 3, supports_chat: false };
  const models = [
    { id: "gpt-5", supported_endpoint_types: ["openai"] },
    { id: "gpt-image-1", supported_endpoint_types: ["image-generation", "image-edit"], image },
    { id: "gemini-image-fixture", supported_endpoint_types: ["image-generation", "openai"], image: { generation_path: image.generation_path, reference_path: image.generation_path, aspect_ratios: ["1:1", "16:9"], max_count: 1, supports_chat: true } },
    { id: "seedream-fixture", supported_endpoint_types: ["image-generation"], image: { generation_path: image.generation_path, reference_path: image.generation_path, sizes: ["2K", "4K"], max_count: 2, supports_chat: false } },
    { id: "text-only-image-fixture", supported_endpoint_types: ["image-generation"], image: { generation_path: image.generation_path, max_count: 1, supports_chat: false } },
    { id: "video-fixture", supported_endpoint_types: ["video"] },
  ];
  const catalog = { user: { id: 901, display_name: "Image QA" }, supported_endpoints: {
    openai: { path: "/v1/chat/completions", method: "POST" },
    "image-generation": { path: image.generation_path, method: "POST" }, "image-edit": { path: image.reference_path, method: "POST" },
  }, groups: [
    { id: "中文 分组", name: "中文 分组", description: "Reference images and full quality controls", ratio: 0.06, dynamic_billing: false, models },
    { id: "auto", name: "auto", description: "Dynamic route with conservative capabilities", ratio: null, dynamic_billing: true, models: [{ id: "gpt-image-1", supported_endpoint_types: ["image-generation"], image: { generation_path: image.generation_path, max_count: 1, supports_chat: false } }, models[0]] },
  ] };
  let origin;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const raw = []; for await (const part of req) raw.push(part);
      const body = Buffer.concat(raw).toString();
      const json = (status, data) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
      if (url.pathname.endsWith("/oauth/authorize")) {
        const target = new URL(url.searchParams.get("redirect_uri")); target.searchParams.set("state", url.searchParams.get("state")); target.searchParams.set("code", "image-fixture-code");
        res.writeHead(302, { location: target.toString() }).end(); return;
      }
      if (url.pathname.endsWith("/oauth/token")) {
        if (new URLSearchParams(body).get("grant_type") === "refresh_token") control.refreshes++;
        json(200, { access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer", expires_in: 3600, refresh_expires_in: 86400, authorization_id: "image-qa" }); return;
      }
      if (url.pathname.endsWith("/oauth/revoke")) { control.revocations++; json(200, {}); return; }
      if (url.pathname.endsWith("/catalog")) { json(control.offline ? 503 : 200, control.offline ? {} : { success: true, data: { ...catalog, groups: control.empty ? [] : catalog.groups.filter((group) => !control.removeAuto || group.id !== "auto") } }); return; }
      if (url.pathname === "/image.png") {
        downloads.push({ authorization: req.headers.authorization });
        if (control.downloadsFail) { json(503, {}); return; }
        if (control.downloadsHold) return;
        res.writeHead(200, { "Content-Type": "image/png" }).end(png(1)); return;
      }
      if (url.pathname.startsWith("/v1/images/")) {
        const data = JSON.parse(body);
        calls.push({ path: url.pathname, body: data, group: req.headers["x-mirrorcoding-group"], authenticated: req.headers.authorization === "Bearer fixture-access" });
        if (control.rejectOnce) { control.rejectOnce = false; json(401, { error: { code: "invalid_token" } }); return; }
        if (control.imageStatus !== 200) { if (control.imageStatus === 403) control.removeAuto = true; res.setHeader("Retry-After", "1"); json(control.imageStatus, { error: { code: control.imageStatus === 403 ? "group_unavailable" : "image_error" } }); return; }
        if (control.hold) { res.once("close", () => control.aborted++); return; }
        json(200, { data: Array.from({ length: data.n ?? 1 }, (_, index) => index % 2 || data.prompt.includes("URL") ? { url: `${origin}/image.png` } : { b64_json: bytes.toString("base64"), mime_type: "image/png" }) }); return;
      }
      if (url.pathname === "/v1/chat/completions") {
        const data = JSON.parse(body); chats.push(data);
        const lastUser = data.messages.findLastIndex((m) => m.role === "user");
        const turn = data.messages.slice(lastUser), prompt = JSON.stringify(turn[0]);
        const toolResults = turn.filter((m) => m.role === "tool");
        let tool, args = {}, text = "Chat selection and reasoning preserved.";
        if (prompt.includes("tool-image")) {
          if (!toolResults.length) tool = "ListImageModels";
          else if (toolResults.length === 1) {
            const listing = JSON.parse(toolResults[0].content), selected = listing.models.find((m) => m.modelId === "seedream-fixture");
            tool = "GenerateImage"; args = { providerId: selected.providerId, modelId: selected.modelId, prompt: "Agent selected seedream", options: { count: 1, size: "2K" } };
          } else text = "Agent image is ready. Manual image selection was kept.";
        }
        const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "chat-fixture", object: "chat.completion.chunk", created: 1, model: data.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(chunk({ role: "assistant" }));
        res.write(tool ? chunk({ tool_calls: [{ index: 0, id: `call-${toolResults.length}`, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }) : chunk({ content: text }));
        res.write(chunk({}, tool ? "tool_calls" : "stop")); res.end("data: [DONE]\n\n"); return;
      }
      json(404, {});
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: { message: String(error) } })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, catalog, control, calls, downloads, chats, bytes, close: () => { server.closeAllConnections(); server.close(); } };
}
