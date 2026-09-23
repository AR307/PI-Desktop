import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { imageCapabilitySendable, type MirrorCodingProvider } from "@pi-desktop/shared";
import type { MirrorCodingAccount } from "./account";
import { ENDPOINTS } from "./catalog";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "api-key", "authorization", "x-api-key", "x-goog-api-key", "x-pi-mirrorcoding-key",
]);

function upstreamHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(name) || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");
  return headers;
}

type Binding = { providerId: string; metadata: MirrorCodingProvider; sessionId?: string; imageModelId?: string };

type RelayStage = "validate_request" | "read_request" | "connect_upstream" | "receive_headers" | "stream_response";

export type MirrorCodingRelayFailure = {
  stage: RelayStage;
  providerId?: string;
  path?: string;
  responseHeadersSent: boolean;
  clientDisconnected: boolean;
  errorName: string;
  errorMessage: string;
  causeName?: string;
  causeCode?: string;
  causeMessage?: string;
};

function errorField(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.slice(0, 256);
}

function relayFailure(
  error: unknown,
  details: Omit<MirrorCodingRelayFailure, "errorName" | "errorMessage" | "causeName" | "causeCode" | "causeMessage">,
): MirrorCodingRelayFailure {
  const record = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown; cause?: unknown }
    : undefined;
  const cause = record?.cause && typeof record.cause === "object"
    ? record.cause as { name?: unknown; code?: unknown; message?: unknown }
    : undefined;
  const causeName = errorField(cause?.name);
  const causeCode = errorField(cause?.code);
  const causeMessage = errorField(cause?.message);
  return {
    ...details,
    errorName: errorField(record?.name) ?? typeof error,
    errorMessage: errorField(record?.message) ?? "Unknown relay failure",
    ...(causeName ? { causeName } : {}),
    ...(causeCode ? { causeCode } : {}),
    ...(causeMessage ? { causeMessage } : {}),
  };
}

/** Main owns upstream auth; the sidecar can only use its local selected binding. */
export class MirrorCodingRelay {
  private server = createServer((request, response) => { void this.forward(request, response); });
  private bindings = new Map<string, Binding>();
  private requests = new Map<AbortController, Binding>();
  private listening?: Promise<string>;
  constructor(
    private account: MirrorCodingAccount,
    private logFailure: (failure: MirrorCodingRelayFailure) => void = () => {},
  ) {}

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
    return [...new Set([...this.bindings.values()].flatMap((value) => value.sessionId && !value.imageModelId ? [value.sessionId] : []))];
  }
  hasActiveRequests(): boolean { return this.requests.size > 0; }

  async bindImage(providerId: string, metadata: MirrorCodingProvider, modelId: string, sessionId: string) {
    const state = this.account.snapshot();
    if (state.status !== "connected" || state.account?.id !== metadata.accountId) throw new Error("reauthorization_required");
    if (!metadata.imageModels?.[modelId]) throw new Error("model_or_group_unavailable");
    const origin = await this.listen();
    const key = randomBytes(32).toString("base64url");
    this.bindings.set(key, { providerId, metadata, sessionId, imageModelId: modelId });
    return { baseUrl: `${origin}/${providerId}`, headers: { "x-pi-mirrorcoding-key": key }, release: () => { this.bindings.delete(key); } };
  }

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
    let stage: RelayStage = "validate_request";
    let binding: Binding | undefined;
    let path: string | undefined;
    response.once("close", disconnect);
    try {
      const key = request.headers["x-pi-mirrorcoding-key"];
      const selectedBinding = typeof key === "string" ? this.bindings.get(key) : undefined;
      binding = selectedBinding;
      if (!selectedBinding || request.method !== "POST" || request.headers.origin) {
        response.writeHead(403).end();
        return;
      }
      const state = this.account.snapshot();
      if (state.status !== "connected" || state.account?.id !== selectedBinding.metadata.accountId) throw new Error("reauthorization_required");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const prefix = `/${selectedBinding.providerId}`;
      if (!url.pathname.startsWith(`${prefix}/`)) { response.writeHead(404).end(); return; }
      path = url.pathname.slice(prefix.length);
      this.requests.set(controller, selectedBinding);
      stage = "read_request";
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      const headers = upstreamHeaders(request);
      headers.set("X-Mirrorcoding-Group", encodeURIComponent(selectedBinding.metadata.groupId));
      let query = "";
      let upstreamBody: BodyInit;
      if (selectedBinding.imageModelId) {
        if (path !== "/v1/images/generations" && path !== "/v1/images/edits") throw new Error("model_or_group_unavailable");
        const group = state.catalog?.groups.find((entry) => entry.id === selectedBinding.metadata.groupId);
        const catalogModel = group?.models.find((entry) => entry.id === selectedBinding.imageModelId);
        if (!catalogModel?.supported_endpoint_types.includes("image-generation") || !imageCapabilitySendable(catalogModel.image)) {
          throw new Error("model_or_group_unavailable");
        }
        if (path === "/v1/images/generations") {
          let payload: { model?: unknown };
          const body = raw.toString("utf8");
          try {
            payload = JSON.parse(body) as { model?: unknown };
          } catch {
            throw new Error("invalid_model_request");
          }
          if (payload.model !== selectedBinding.imageModelId) throw new Error("model_or_group_unavailable");
          upstreamBody = body;
        } else {
          // Electron net.fetch expects web BodyInit values, not Node Buffer instances.
          upstreamBody = new Uint8Array(raw);
        }
      } else {
        let payload: { model?: unknown };
        const body = raw.toString("utf8");
        try {
          payload = JSON.parse(body) as { model?: unknown };
        } catch {
          throw new Error("invalid_model_request");
        }
        const gemini = /^\/v1beta\/models\/(.+):(streamGenerateContent|generateContent)$/.exec(path);
        const modelId = gemini ? decodeURIComponent(gemini[1]) : payload.model;
        if (typeof modelId !== "string") throw new Error("invalid_model_request");
        const group = state.catalog?.groups.find((entry) => entry.id === selectedBinding.metadata.groupId);
        const catalogModel = group?.models.find((entry) => entry.id === modelId);
        const endpoint = selectedBinding.metadata.routes[modelId];
        if (!endpoint || (endpoint === "gemini" ? !gemini : path !== ENDPOINTS[endpoint].path) ||
            !catalogModel?.supported_endpoint_types.includes(endpoint)) throw new Error("model_or_group_unavailable");
        query = gemini?.[2] === "streamGenerateContent" ? "?alt=sse" : "";
        upstreamBody = body;
      }
      stage = "connect_upstream";
      const upstream = await this.account.request(`${path}${query}`, { method: "POST", headers, body: upstreamBody, signal: controller.signal });
      stage = "receive_headers";
      if (upstream.status === 403) {
        const denied = await upstream.clone().json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        if (denied?.error?.code?.includes("group") || denied?.error?.message === "The selected group is not available to this account") {
          void this.account.groupUnavailable();
        }
      }
      const outputHeaders: Record<string, string> = {};
      for (const name of ["content-type", "retry-after", "x-oneapi-request-id", "x-upstream-request-id", "x-request-id", "request-id"]) {
        const value = upstream.headers.get(name);
        if (value) outputHeaders[name] = value;
      }
      response.writeHead(upstream.status, outputHeaders);
      if (upstream.body) {
        // Pipeline propagates disconnects and honors writable backpressure.
        stage = "stream_response";
        await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), response, { signal: controller.signal });
      } else response.end();
    } catch (error) {
      this.logFailure(relayFailure(error, {
        stage,
        ...(binding ? { providerId: binding.providerId } : {}),
        ...(path ? { path } : {}),
        responseHeadersSent: response.headersSent,
        clientDisconnected: controller.signal.aborted,
      }));
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
