import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  ImageGenerationCapability,
  MirrorCodingEndpoint,
  MirrorCodingImageEndpoint,
  MirrorCodingProvider,
} from "@pi-desktop/shared";
import { validateImageOptions } from "@pi-desktop/shared";
import type { MirrorCodingAccount } from "./account";
import { ENDPOINTS, IMAGE_ENDPOINTS } from "./catalog";
import { relayBindingKey } from "./relay-key";
import { isMirrorCodingEndpointPath, mirrorCodingChatRoute } from "./chat-route";

type Binding = {
  providerId: string;
  metadata: MirrorCodingProvider;
  sessionId?: string;
  kind: "chat" | "image";
  endpoint: MirrorCodingEndpoint | MirrorCodingImageEndpoint;
  groupId: string;
  imageModelId?: string;
};
function imageCapability(metadata: MirrorCodingProvider, modelId: string): ImageGenerationCapability {
  const capability = metadata.imageModels?.[modelId];
  if (!capability) throw new Error("model_or_group_unavailable");
  return capability;
}

function selectedGroup(metadata: MirrorCodingProvider, groupId?: string): MirrorCodingProvider {
  if (metadata.scope !== "account") {
    if (groupId && groupId !== metadata.groupId) throw new Error("model_or_group_unavailable");
    return metadata;
  }
  const selected = groupId;
  const route = metadata.groups?.find((group) => group.id === selected);
  if (!route) throw new Error("model_or_group_unavailable");
  return {
    scope: "group",
    accountId: metadata.accountId,
    groupId: route.id,
    groupName: route.name,
    description: route.description,
    ratio: route.ratio,
    dynamicBilling: route.dynamicBilling,
    routes: route.routes,
    modelCapabilities: route.modelCapabilities, supportedEndpoints: route.supportedEndpoints,
    candidateGroups: route.candidateGroups,
    ...(route.imageRoutes ? { imageRoutes: route.imageRoutes } : {}),
    ...(route.imageCapabilities ? { imageCapabilities: route.imageCapabilities } : {}),
    ...(route.imageModels ? { imageModels: route.imageModels } : {}),
  };
}

/** Main owns upstream auth; the sidecar can only use its local selected binding. */
export class MirrorCodingRelay {
  private server = createServer((request, response) => { void this.forward(request, response); });
  private bindings = new Map<string, Binding>();
  private requests = new Map<AbortController, Binding>();
  private listening?: Promise<string>;
  private account: MirrorCodingAccount;
  // An explicit assignment keeps this module loadable under Node's strip-only
  // TypeScript mode, which `node --test` uses for main-process suites.
  constructor(account: MirrorCodingAccount) { this.account = account; }

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
    groupId: string,
  ) {
    const state = this.account.snapshot();
    if (state.status !== "connected" || state.account?.id !== metadata.accountId) throw new Error("reauthorization_required");
    const origin = await this.listen();
    // Reuse one ephemeral credential per session/group/route until logout or shutdown.
    const existing = [...this.bindings].find(([, value]) => value.providerId === providerId && value.sessionId === sessionId && value.kind === kind && value.endpoint === endpoint && value.groupId === groupId && (kind !== "image" || value.imageModelId === modelId));
    const key = existing?.[0] ?? randomBytes(32).toString("base64url");
    this.bindings.set(key, { providerId, metadata, sessionId, kind, endpoint, groupId, ...(kind === "image" ? { imageModelId: modelId } : {}) });
    const route = kind === "chat" ? ENDPOINTS[endpoint as MirrorCodingEndpoint] : IMAGE_ENDPOINTS[endpoint as MirrorCodingImageEndpoint];
    return {
      baseUrl: `${origin}/${providerId}${route.prefix}`,
      apiKey: key, ...(kind === "chat" ? { apiStyle: ENDPOINTS[endpoint as MirrorCodingEndpoint].style, api: ENDPOINTS[endpoint as MirrorCodingEndpoint].api } : {}),
      headers: { "x-pi-mirrorcoding-key": key },
    };
  }

  async bind(providerId: string, metadata: MirrorCodingProvider, modelId: string, sessionId?: string, groupId?: string) {
    const group = selectedGroup(metadata, groupId);
    const catalog = this.account.snapshot().catalog;
    const model = catalog?.groups.find(entry => entry.id === group.groupId)?.models.find(entry => entry.id === modelId);
    const endpoint = model && catalog ? mirrorCodingChatRoute(model, catalog.supportedEndpoints, group.routes[modelId]) : undefined;
    if (!endpoint) throw new Error("model_or_group_unavailable");
    const fastAvailable = (endpoint === "openai" || endpoint === "openai-response") &&
      model?.fast?.enabled === true && model.fast.supportedEndpointTypes.includes(endpoint);
    return { ...await this.bindInternal(providerId, group, modelId, sessionId, "chat", endpoint, group.groupId), fastAvailable };
  }

  async bindImage(providerId: string, metadata: MirrorCodingProvider, modelId: string, sessionId: string | undefined, edit = false, groupId?: string) {
    const group = selectedGroup(metadata, groupId);
    const routes = group.imageRoutes?.[modelId];
    const endpoint = edit ? routes?.reference : routes?.generation;
    if (!endpoint || (!edit && endpoint !== "image-generation") || (edit && endpoint !== "image-edit" && endpoint !== "image-generation")) {
      throw new Error("model_or_group_unavailable");
    }
    const bound = await this.bindInternal(providerId, group, modelId, sessionId, "image", endpoint, group.groupId);
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
      const key = relayBindingKey(request.headers);
      const binding = key ? this.bindings.get(key) : undefined;
      // The relay is authenticated by a per-binding random key. pi-ai may
      // attach an Origin header even though this is a sidecar request, so
      // Origin is not a reliable browser boundary here.
      if (!binding) {
        response.writeHead(403, { "Content-Type": "application/json" }).end(
          JSON.stringify({ error: { code: "relay_binding_missing", message: "relay binding missing" } }),
        );
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(403, { "Content-Type": "application/json" }).end(
          JSON.stringify({ error: { code: "relay_method_forbidden", message: "relay method forbidden" } }),
        );
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
      let payload: Record<string, unknown> = {};
      if (contentType.toLowerCase().includes("application/json")) {
        payload = JSON.parse(body) as Record<string, unknown>;
      } else if (contentType.toLowerCase().includes("multipart/form-data")) {
        const model = /name="model"\r?\n\r?\n([^\r\n]+)/.exec(body)?.[1];
        payload = { model };
      }
      const gemini = /^\/v1beta\/models\/(.+):(streamGenerateContent|generateContent)$/.exec(path);
      const modelId = gemini ? decodeURIComponent(gemini[1]) : payload.model;
      if (typeof modelId !== "string") throw new Error("invalid_model_request");
      const imageRoutes = binding.metadata.imageRoutes?.[modelId];
      const endpoint = binding.kind === "chat" ? binding.endpoint :
        (Array.isArray(payload.images) && payload.images.length > 0 ? imageRoutes?.reference : imageRoutes?.generation);
      const expectedPath = binding.kind === "chat"
        ? (endpoint ? ENDPOINTS[endpoint as MirrorCodingEndpoint].path : "")
        : (endpoint ? IMAGE_ENDPOINTS[endpoint as MirrorCodingImageEndpoint].path : "");
      if (!endpoint || (binding.kind === "chat" && (endpoint !== binding.endpoint || (endpoint === "gemini" ? !gemini : path !== expectedPath))) ||
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
        ? Boolean(currentModel?.modes.includes("text") && endpoint && currentModel.supportedEndpointTypes.includes(endpoint))
        : Boolean(currentModel?.modes.includes("image") && currentCapability && endpoint && currentPath === IMAGE_ENDPOINTS[endpoint as MirrorCodingImageEndpoint].path &&
            currentModel?.supportedEndpointTypes.includes(endpoint));
      if (!currentModel || !routeAvailable) {
        throw new Error("model_or_group_unavailable");
      }
      const advertised = endpoint && state.catalog?.supportedEndpoints[endpoint];
      if (!advertised || advertised.method !== "POST" || !isMirrorCodingEndpointPath(advertised.path)) {
        throw new Error("model_or_group_unavailable");
      }
      if (payload.service_tier !== undefined) {
        if (binding.kind !== "chat") throw new Error("invalid_image_parameter");
        if (payload.service_tier !== "fast" && payload.service_tier !== "default") throw new Error("invalid_service_tier");
        if (payload.service_tier === "fast" && !((endpoint === "openai" || endpoint === "openai-response") &&
            currentModel.fast?.enabled && currentModel.fast.supportedEndpointTypes.includes(endpoint))) {
          void this.account.groupUnavailable();
          throw new Error("pi_fast_unavailable");
        }
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
      let upstreamPath = advertised.path.replace("{model}", encodeURIComponent(modelId));
      if (gemini?.[2] === "streamGenerateContent") upstreamPath = upstreamPath.replace(/:generateContent$/, ":streamGenerateContent");
      const upstream = await this.account.request(`${upstreamPath}${query}`, { method: "POST", headers, body: rawBody, signal: controller.signal });
      if (upstream.status === 400 || upstream.status === 403) {
        const denied = await upstream.clone().json().catch(() => null) as { code?: string; error?: { code?: string; message?: string } } | null;
        const code = denied?.error?.code ?? denied?.code;
        if (code === "pi_fast_unavailable" || code?.includes("group") || denied?.error?.message === "The selected group is not available to this account") {
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
        response.writeHead(code === "reauthorization_required" ? 401 : code === "model_or_group_unavailable" ? 403 :
          ["pi_fast_unavailable", "invalid_service_tier", "invalid_image_parameter"].includes(code) ? 400 : 502, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: code, code } }));
      }
    } finally {
      this.requests.delete(controller);
      response.off("close", disconnect);
    }
  }
}
