import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  ImageGenerationCapability,
  ImageGenerationOptions,
  MirrorCodingEndpoint,
  MirrorCodingImageEndpoint,
  MirrorCodingProvider,
} from "@pi-desktop/shared";
import { validateImageOptions } from "@pi-desktop/shared";
import type { MirrorCodingAccount } from "./account";
import { ENDPOINTS, IMAGE_ENDPOINTS } from "./catalog";

type Binding = {
  providerId: string;
  metadata: MirrorCodingProvider;
  sessionId?: string;
  kind: "chat" | "image";
  endpoint: MirrorCodingEndpoint | MirrorCodingImageEndpoint;
  imageModelId?: string;
};
export type ImageReference = { data: string; mimeType: string; name?: string };

function imagePayload(options: ImageGenerationOptions | undefined): Record<string, unknown> {
  return {
    ...(options?.count !== undefined ? { n: options.count } : {}),
    ...(options?.size ? { size: options.size } : {}),
    ...(options?.quality ? { quality: options.quality } : {}),
    ...(options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
  };
}

function imageCapability(metadata: MirrorCodingProvider, modelId: string): ImageGenerationCapability {
  const capability = metadata.imageModels?.[modelId];
  if (!capability) throw new Error("model_or_group_unavailable");
  return capability;
}

/** Main owns upstream auth; the sidecar can only use its local selected binding. */
export class MirrorCodingRelay {
  private server = createServer((request, response) => { void this.forward(request, response); });
  private bindings = new Map<string, Binding>();
  private requests = new Map<AbortController, Binding>();
  private imageRequests = new Set<AbortController>();
  private listening?: Promise<string>;
  constructor(private account: MirrorCodingAccount) {}

  private listen(): Promise<string> {
    return this.listening ??= new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(this.server.address() as AddressInfo).port}`));
    });
  }

  private async bindInternal(
    providerId: string,
    metadata: MirrorCodingProvider,
    modelId: string,
    sessionId: string | undefined,
    kind: "chat" | "image",
    endpoint: MirrorCodingEndpoint | MirrorCodingImageEndpoint,
  ) {
    const state = this.account.snapshot();
    if (state.status !== "connected" || state.account?.id !== metadata.accountId) throw new Error("reauthorization_required");
    const origin = await this.listen();
    // Reuse one ephemeral credential per session/group/route until logout or shutdown.
    const existing = [...this.bindings].find(([, value]) => value.providerId === providerId && value.sessionId === sessionId && value.kind === kind && value.endpoint === endpoint && (kind !== "image" || value.imageModelId === modelId));
    const key = existing?.[0] ?? randomBytes(32).toString("base64url");
    this.bindings.set(key, { providerId, metadata, sessionId, kind, endpoint, ...(kind === "image" ? { imageModelId: modelId } : {}) });
    const route = kind === "chat" ? ENDPOINTS[endpoint as MirrorCodingEndpoint] : IMAGE_ENDPOINTS[endpoint as MirrorCodingImageEndpoint];
    return {
      baseUrl: `${origin}/${providerId}${route.prefix}`,
      apiKey: key, ...(kind === "chat" ? { apiStyle: ENDPOINTS[endpoint as MirrorCodingEndpoint].style, api: ENDPOINTS[endpoint as MirrorCodingEndpoint].api } : {}),
      headers: { "x-pi-mirrorcoding-key": key },
    };
  }

  async bind(providerId: string, metadata: MirrorCodingProvider, modelId: string, sessionId?: string) {
    const endpoint = metadata.routes[modelId];
    if (!endpoint) throw new Error("model_or_group_unavailable");
    return this.bindInternal(providerId, metadata, modelId, sessionId, "chat", endpoint);
  }

  async bindImage(providerId: string, metadata: MirrorCodingProvider, modelId: string, sessionId: string | undefined, edit = false) {
    const routes = metadata.imageRoutes?.[modelId];
    const endpoint = edit ? routes?.reference : routes?.generation;
    if (!endpoint || (!edit && endpoint !== "image-generation") || (edit && endpoint !== "image-edit" && endpoint !== "image-generation")) {
      throw new Error("model_or_group_unavailable");
    }
    const bound = await this.bindInternal(providerId, metadata, modelId, sessionId, "image", endpoint);
    const origin = await this.listen();
    return {
      ...bound,
      baseUrl: `${origin}/${providerId}`,
      release: () => { this.bindings.delete(bound.apiKey); },
    };
  }

  boundSessions(): string[] {
    return [...new Set([...this.bindings.values()].flatMap((value) => value.sessionId && !value.imageModelId ? [value.sessionId] : []))];
  }
  hasActiveRequests(): boolean { return this.requests.size > 0 || this.imageRequests.size > 0; }

  async requestImage(
    metadata: MirrorCodingProvider,
    modelId: string,
    prompt: string,
    options: ImageGenerationOptions,
    references: readonly ImageReference[],
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    this.imageRequests.add(controller);
    try {
      const state = this.account.snapshot();
      if (state.status !== "connected" || state.account?.id !== metadata.accountId) {
        throw new Error("reauthorization_required");
      }
      const capability = imageCapability(metadata, modelId);
      const group = state.catalog?.groups.find((entry) => entry.id === metadata.groupId);
      const catalogModel = group?.models.find((entry) => entry.id === modelId);
      if (!catalogModel?.image || !catalogModel.supportedEndpointTypes.includes("image-generation")) {
        throw new Error("model_or_group_unavailable");
      }
      if (references.length > 0 && !capability.reference_path) {
        throw new Error("images_reference_unsupported");
      }
      const path = references.length > 0
        ? capability.reference_path ?? capability.generation_path
        : capability.generation_path;
      if (path !== "/v1/images/generations" && path !== "/v1/images/edits") {
        throw new Error("model_or_group_unavailable");
      }
      if (references.length > 0 && !catalogModel.supportedEndpointTypes.includes(path === "/v1/images/edits" ? "image-edit" : "image-generation")) {
        throw new Error("model_or_group_unavailable");
      }
      const headers = new Headers({
        Accept: "application/json",
        "X-Mirrorcoding-Group": encodeURIComponent(metadata.groupId),
      });
      let body: BodyInit;
      if (path === "/v1/images/edits") {
        const form = new FormData();
        form.set("model", modelId);
        form.set("prompt", prompt);
        for (const [key, value] of Object.entries(imagePayload(options))) form.set(key, String(value));
        for (const reference of references) {
          const bytes = Buffer.from(reference.data, "base64");
          form.append(
            "image",
            new Blob([bytes], { type: reference.mimeType }),
            reference.name || "reference-image",
          );
        }
        body = form;
      } else {
        body = JSON.stringify({
          model: modelId,
          prompt,
          ...imagePayload(options),
          ...(references.length > 0
            ? { images: references.map((reference) => ({ image_url: `data:${reference.mimeType};base64,${reference.data}` })) }
            : {}),
        });
        headers.set("Content-Type", "application/json");
      }
      const response = await this.account.request(path, { method: "POST", headers, body, signal: controller.signal });
      if (response.status === 403) {
        const denied = await response.clone().json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        if (denied?.error?.code?.includes("group") || denied?.error?.message === "The selected group is not available to this account") {
          void this.account.groupUnavailable();
        }
      }
      return response;
    } finally {
      this.imageRequests.delete(controller);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  invalidate(): void {
    for (const controller of this.requests.keys()) controller.abort();
    for (const controller of this.imageRequests) controller.abort();
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
      const rawBody = Buffer.concat(chunks);
      const body = rawBody.toString("utf8");
      const contentType = String(request.headers["content-type"] ?? "");
      let payload: { model?: unknown; images?: unknown; n?: unknown; size?: unknown; quality?: unknown; aspect_ratio?: unknown } = {};
      if (contentType.toLowerCase().includes("application/json")) {
        payload = JSON.parse(body) as { model?: unknown; images?: unknown; n?: unknown; size?: unknown; quality?: unknown; aspect_ratio?: unknown };
      } else if (contentType.toLowerCase().includes("multipart/form-data")) {
        const model = /name="model"\r?\n\r?\n([^\r\n]+)/.exec(body)?.[1];
        payload = { model };
      }
      const gemini = /^\/v1beta\/models\/(.+):(streamGenerateContent|generateContent)$/.exec(path);
      const modelId = gemini ? decodeURIComponent(gemini[1]) : payload.model;
      if (typeof modelId !== "string") throw new Error("invalid_model_request");
      const imageRoutes = binding.metadata.imageRoutes?.[modelId];
      const endpoint = binding.kind === "chat" ? binding.metadata.routes[modelId] :
        (Array.isArray(payload.images) && payload.images.length > 0 ? imageRoutes?.reference : imageRoutes?.generation);
      const expectedPath = binding.kind === "chat"
        ? (binding.metadata.routes[modelId] ? ENDPOINTS[binding.metadata.routes[modelId]!].path : "")
        : (endpoint ? IMAGE_ENDPOINTS[endpoint as MirrorCodingImageEndpoint].path : "");
      if (!endpoint || (binding.kind === "chat" && (endpoint === "gemini" ? !gemini : path !== expectedPath)) ||
          (binding.kind === "image" && path !== expectedPath)) {
        response.writeHead(403).end(JSON.stringify({ error: { message: "Model or group unavailable", code: "model_or_group_unavailable" } }));
        return;
      }
      // Availability is checked against the most recent catalog, including empty catalogs.
      const group = state.catalog?.groups.find((entry) => entry.id === binding.metadata.groupId);
      const currentModel = group?.models.find((model) => model.id === modelId);
      const hasReferences = Array.isArray(payload.images) && payload.images.length > 0 ||
        (contentType.toLowerCase().includes("multipart/form-data") && /name="(?:image|images)"/.test(body));
      const currentCapability = currentModel?.image;
      const currentPath = hasReferences ? currentCapability?.referencePath : currentCapability?.generationPath;
      const routeAvailable = binding.kind === "chat"
        ? Boolean(currentModel?.supportedEndpointTypes.includes(endpoint as MirrorCodingEndpoint))
        : Boolean(currentCapability && endpoint && currentPath === IMAGE_ENDPOINTS[endpoint as MirrorCodingImageEndpoint].path &&
            currentModel?.supportedEndpointTypes.includes(endpoint));
      if (!currentModel || !routeAvailable) {
        throw new Error("model_or_group_unavailable");
      }
      if (binding.kind === "image" && contentType.toLowerCase().includes("application/json")) {
        const capability = imageCapability(binding.metadata, modelId);
        validateImageOptions(capability, {
          count: typeof payload.n === "number" ? payload.n : undefined,
          size: typeof payload.size === "string" ? payload.size : undefined,
          quality: typeof payload.quality === "string" ? payload.quality : undefined,
          aspectRatio: typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : undefined,
        }, Array.isArray(payload.images) ? payload.images.length : 0);
      }
      const headers = new Headers({
        "Content-Type": contentType || "application/json", Accept: "application/json, text/event-stream",
        "X-Mirrorcoding-Group": encodeURIComponent(binding.metadata.groupId),
      });
      for (const name of ["anthropic-version", "anthropic-beta"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const query = gemini?.[2] === "streamGenerateContent" ? "?alt=sse" : "";
      const upstream = await this.account.request(`${path}${query}`, { method: "POST", headers, body: rawBody, signal: controller.signal });
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
