import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MirrorCodingProvider } from "@pi-desktop/shared";
import type { MirrorCodingAccount } from "./account";
import { ENDPOINTS } from "./catalog";

type Binding = { providerId: string; metadata: MirrorCodingProvider; sessionId?: string };

/** Main owns upstream auth; the sidecar can only use its local selected binding. */
export class MirrorCodingRelay {
  private server = createServer((request, response) => { void this.forward(request, response); });
  private bindings = new Map<string, Binding>();
  private requests = new Map<AbortController, Binding>();
  private listening?: Promise<string>;
  constructor(private account: MirrorCodingAccount) {}

  private listen(): Promise<string> {
    return this.listening ??= new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(this.server.address() as AddressInfo).port}`));
    });
  }

  async bind(providerId: string, metadata: MirrorCodingProvider, modelId: string, sessionId?: string) {
    const state = this.account.snapshot();
    if (state.status !== "connected" || state.account?.id !== metadata.accountId) throw new Error("reauthorization_required");
    const endpoint = metadata.routes[modelId];
    if (!endpoint) throw new Error("model_or_group_unavailable");
    const origin = await this.listen();
    // Reuse one ephemeral credential per session/group until logout or shutdown.
    const existing = [...this.bindings].find(([, value]) => value.providerId === providerId && value.sessionId === sessionId);
    const key = existing?.[0] ?? randomBytes(32).toString("base64url");
    this.bindings.set(key, { providerId, metadata, sessionId });
    return {
      baseUrl: `${origin}/${providerId}${ENDPOINTS[endpoint].prefix}`,
      apiKey: key, apiStyle: ENDPOINTS[endpoint].style,
      headers: { "x-pi-mirrorcoding-key": key }, api: ENDPOINTS[endpoint].api,
    };
  }

  boundSessions(): string[] {
    return [...new Set([...this.bindings.values()].flatMap((value) => value.sessionId ? [value.sessionId] : []))];
  }
  hasActiveRequests(): boolean { return this.requests.size > 0; }

  invalidate(): void {
    for (const controller of this.requests.keys()) controller.abort();
    this.bindings.clear();
  }

  dispose(): void {
    this.invalidate();
    this.server.close();
    this.server.closeAllConnections();
  }

  private async forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableFinished) controller.abort(); };
    response.once("close", disconnect);
    try {
      const key = request.headers["x-pi-mirrorcoding-key"];
      const binding = typeof key === "string" ? this.bindings.get(key) : undefined;
      if (!binding || request.method !== "POST" || request.headers.origin) {
        response.writeHead(403).end();
        return;
      }
      const state = this.account.snapshot();
      if (state.status !== "connected" || state.account?.id !== binding.metadata.accountId) throw new Error("reauthorization_required");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const prefix = `/${binding.providerId}`;
      if (!url.pathname.startsWith(`${prefix}/`)) { response.writeHead(404).end(); return; }
      const path = url.pathname.slice(prefix.length);
      this.requests.set(controller, binding);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      const payload = JSON.parse(body) as { model?: unknown };
      const gemini = /^\/v1beta\/models\/(.+):(streamGenerateContent|generateContent)$/.exec(path);
      const modelId = gemini ? decodeURIComponent(gemini[1]) : payload.model;
      if (typeof modelId !== "string") throw new Error("invalid_model_request");
      const endpoint = binding.metadata.routes[modelId];
      if (!endpoint || (endpoint === "gemini" ? !gemini : path !== ENDPOINTS[endpoint].path)) {
        response.writeHead(403).end(JSON.stringify({ error: { message: "Model or group unavailable", code: "model_or_group_unavailable" } }));
        return;
      }
      // Availability is checked against the most recent catalog, including empty catalogs.
      const group = state.catalog?.groups.find((entry) => entry.id === binding.metadata.groupId);
      if (!group?.models.some((model) => model.id === modelId && model.supported_endpoint_types.includes(endpoint))) {
        throw new Error("model_or_group_unavailable");
      }
      const headers = new Headers({
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "X-Mirrorcoding-Group": encodeURIComponent(binding.metadata.groupId),
      });
      for (const name of ["anthropic-version", "anthropic-beta"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const query = gemini?.[2] === "streamGenerateContent" ? "?alt=sse" : "";
      const upstream = await this.account.request(`${path}${query}`, { method: "POST", headers, body, signal: controller.signal });
      if (upstream.status === 403) {
        const denied = await upstream.clone().json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        if (denied?.error?.code?.includes("group") || denied?.error?.message === "The selected group is not available to this account") {
          void this.account.groupUnavailable();
        }
      }
      const outputHeaders: Record<string, string> = {};
      for (const name of ["content-type", "retry-after", "x-request-id", "request-id"]) {
        const value = upstream.headers.get(name);
        if (value) outputHeaders[name] = value;
      }
      response.writeHead(upstream.status, outputHeaders);
      if (upstream.body) {
        // Pipeline propagates disconnects and honors writable backpressure.
        await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), response, { signal: controller.signal });
      } else response.end();
    } catch (error) {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) {
        const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "mirrorcoding_request_failed";
        response.writeHead(code === "reauthorization_required" ? 401 : code === "model_or_group_unavailable" ? 403 : 502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: code, code } }));
      }
    } finally {
      this.requests.delete(controller);
      response.off("close", disconnect);
    }
  }
}
