import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import {
  IPC,
  MIRRORCODING_ORIGIN,
  validateImageOptions,
  type AppSettings,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageOutput,
  type MirrorCodingProvider,
  type ProviderPublic,
  type UiMessage,
} from "@pi-desktop/shared";
import { capabilitiesFromModelConfig, modelConfigWithBinding, type RuntimeProviderConfig } from "@pi-desktop/agent-runtime";
import type { HostProcess } from "../host-process";
import type { ModelsDevCatalog } from "../models-dev-catalog";
import { ensureAttachmentBlob, preparePromptAttachments } from "../prompt-attachments";
import { MirrorCodingAccount } from "./account";
import { modelMetadata } from "./catalog";
import { MirrorCodingCredentials } from "./credentials";
import { MirrorCodingRelay, type ImageReference } from "./relay";

type Dependencies = {
  dataDir: string;
  getHost(): HostProcess | null;
  modelsDev: ModelsDevCatalog;
  openExternal(url: string): Promise<void>;
  send(channel: string, state: unknown): void;
};

export function createMirrorCodingRuntime(deps: Dependencies) {
  const host = () => {
    const value = deps.getHost();
    if (!value) throw new Error("host_unavailable");
    return value;
  };
  // Only unpackaged, isolated local acceptance may replace the official origin.
  let origin: string = MIRRORCODING_ORIGIN;
  const testOrigin = process.env.PI_DESKTOP_MIRRORCODING_TEST_ORIGIN;
  if (!app.isPackaged && testOrigin && process.env.PI_DESKTOP_DATA_DIR) {
    const url = new URL(testOrigin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/") throw new Error("invalid_test_origin");
    origin = url.origin;
  }
  const completeWelcome = async () => {
    const settings = await host().call<AppSettings>("settings.get");
    await host().call("settings.set", { ...settings, mirrorCodingWelcomeCompleted: true });
  };
  const account = new MirrorCodingAccount({
    origin, credentials: new MirrorCodingCredentials(join(deps.dataDir, "mirrorcoding.enc"), safeStorage),
    fetch: (...args) => globalThis.fetch(...args), modelsDev: deps.modelsDev,
    openExternal: deps.openExternal, completeWelcome,
    syncProviders: async (input) => { await host().call("providers.syncMirrorCoding", input); },
    changed: (state) => deps.send(IPC.event.mirrorCodingChanged, state),
  });
  const relay = new MirrorCodingRelay(account);
  const imageJobs = new Map<string, AbortController>();

  const imageModel = (provider: ProviderPublic, modelId: string) => {
    const metadata = provider.mirrorCoding;
    const capability = metadata?.imageModels?.[modelId];
    if (!provider.enabled || !metadata || !capability) throw new Error("model_or_group_unavailable");
    return {
      providerId: provider.id,
      modelId,
      displayName: modelId,
      groupName: metadata.groupName,
      description: metadata.description,
      ratio: metadata.ratio,
      dynamicBilling: metadata.dynamicBilling,
      capability,
    };
  };

  const parseImageOutputs = (value: unknown): ImageOutput[] => {
    if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
      throw new Error("invalid_image_response");
    }
    const outputs: ImageOutput[] = [];
    for (const item of (value as { data: unknown[] }).data) {
      if (!item || typeof item !== "object") continue;
      const row = item as { b64_json?: unknown; url?: unknown; mime_type?: unknown; mimeType?: unknown };
      const mimeType = typeof row.mime_type === "string" ? row.mime_type : typeof row.mimeType === "string" ? row.mimeType : undefined;
      if (typeof row.b64_json === "string" && row.b64_json.trim()) outputs.push({ data: row.b64_json, mimeType });
      else if (typeof row.url === "string" && row.url.trim()) outputs.push({ url: row.url, mimeType });
    }
    if (!outputs.length) throw new Error("invalid_image_response");
    return outputs;
  };

  const persistImage = async (output: ImageOutput, id: string, signal: AbortSignal) => {
    let bytes: Buffer;
    let mimeType = output.mimeType || "image/png";
    let sourceUrl: string | undefined;
    try {
      if (output.data) {
        const match = /^data:([^;,]+);base64,(.*)$/s.exec(output.data);
        const raw = match ? match[2] : output.data;
        if (match?.[1]) mimeType = match[1];
        bytes = Buffer.from(raw, "base64");
      } else if (output.url) {
        const url = new URL(output.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_image_url");
        sourceUrl = url.toString();
        const response = await globalThis.fetch(sourceUrl, { redirect: "error", signal });
        if (!response.ok) throw new Error("image_download_failed");
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (contentType?.startsWith("image/")) mimeType = contentType;
        bytes = Buffer.from(await response.arrayBuffer());
      } else throw new Error("invalid_image_response");
      if (!bytes.length) throw new Error("invalid_image_response");
      const extension = mimeType.split("/", 2)[1]?.replace(/[^a-z0-9]/gi, "") || "png";
      return {
        id,
        attachment: {
          kind: "image" as const,
          name: `generated-${id}.${extension}`,
          ref: ensureAttachmentBlob(deps.dataDir, bytes),
          mimeType,
          size: bytes.length,
        },
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        id,
        ...(sourceUrl ? { downloadUrl: sourceUrl } : {}),
        error: error instanceof Error && error.message === "invalid_image_url" ? error.message : "image_download_failed",
      };
    }
  };

  const bindingFor = async (providerId: string, modelId: string, sessionId?: string): Promise<RuntimeProviderConfig> => {
    await account.initialize();
    const result = await host().call<{ provider?: ProviderPublic }>("providers.get", { id: providerId });
    const provider = result.provider;
    if (!provider?.enabled || !provider.mirrorCoding || !provider.models.some((model) => model.id === modelId)) {
      throw new Error("model_or_group_unavailable");
    }
    const binding = await relay.bind(providerId, provider.mirrorCoding, modelId, sessionId);
    const modelConfig = {
      ...modelConfigWithBinding(modelMetadata(deps.modelsDev, modelId), provider.models.find((model) => model.id === modelId)),
      api: binding.api, baseUrl: binding.baseUrl,
    };
    const capabilities = capabilitiesFromModelConfig(modelConfig);
    return {
      id: providerId, name: provider.name, vendorKey: "mirrorcoding", authKind: "mirrorcoding",
      modelId, ...binding, modelConfig, ...capabilities, supportedThinkingLevels: [...capabilities.supportedThinkingLevels],
    };
  };

  const bindingForImage = async (
    providerId: string,
    modelId: string,
    sessionId: string | undefined,
    edit: boolean,
  ): Promise<RuntimeProviderConfig> => {
    await account.initialize();
    const result = await host().call<{ provider?: ProviderPublic }>("providers.get", { id: providerId });
    const provider = result.provider;
    if (!provider?.enabled || !provider.mirrorCoding || !provider.mirrorCoding.imageRoutes?.[modelId] ||
        !provider.models.some((model) => model.id === modelId)) {
      throw new Error("model_or_group_unavailable");
    }
    const binding = await relay.bindImage(providerId, provider.mirrorCoding, modelId, sessionId, edit);
    const modelConfig = {
      ...modelConfigWithBinding(modelMetadata(deps.modelsDev, modelId), provider.models.find((model) => model.id === modelId)),
      baseUrl: binding.baseUrl,
    };
    const capabilities = capabilitiesFromModelConfig(modelConfig);
    return {
      id: providerId, name: provider.name, vendorKey: "mirrorcoding", authKind: "mirrorcoding",
      modelId, ...binding, modelConfig, ...capabilities, supportedThinkingLevels: [...capabilities.supportedThinkingLevels],
    };
  };

  const isReady = (metadata?: MirrorCodingProvider): boolean => {
    const state = account.snapshot();
    return Boolean(metadata && state.status === "connected" && state.account?.id === metadata.accountId);
  };
  const generateImage = async (request: ImageGenerationRequest) => {
    const jobId = request.jobId?.trim() || randomUUID();
    if (imageJobs.has(jobId)) throw new Error("image_job_exists");
    const controller = new AbortController();
    imageJobs.set(jobId, controller);
    let turnId: string | undefined;
    try {
      await account.initialize();
      const providerResult = await host().call<{ provider?: ProviderPublic }>("providers.get", { id: request.providerId });
      const provider = providerResult.provider;
      const model = provider ? imageModel(provider, request.modelId) : undefined;
      if (!provider?.mirrorCoding || !model) throw new Error("model_or_group_unavailable");
      const sessionResult = await host().call<{ session?: { projectPath?: string } }>("session.get", { id: request.sessionId, messageLimit: 0 });
      if (!sessionResult.session) throw new Error("session_not_found");
      const prepared = await preparePromptAttachments(
        deps.dataDir,
        request.sessionId,
        sessionResult.session.projectPath,
        request.references ?? [],
        true,
      );
      if (prepared.some((entry) => entry.message.kind !== "image") || prepared.some((entry) => !entry.inlineData)) {
        throw new Error("images_reference_too_large");
      }
      const references: ImageReference[] = prepared.map((entry) => ({
        data: entry.inlineData!, mimeType: entry.message.mimeType || "image/png", name: entry.message.name,
      }));
      const options = validateImageOptions(model.capability, request.options, references.length);
      const turn = await host().call<{ turnId?: string }>("session.beginTurn", {
        sessionId: request.sessionId, providerId: request.providerId, modelId: request.modelId,
      });
      turnId = typeof turn.turnId === "string" && turn.turnId ? turn.turnId : undefined;
      if (!turnId) throw new Error("image_turn_unavailable");
      const userMessage: UiMessage = {
        id: randomUUID(), role: "user", content: request.prompt, createdAt: new Date().toISOString(), status: "complete",
        ...(prepared.length ? { attachments: prepared.map((entry) => entry.message) } : {}),
      };
      await host().call("session.appendMessage", { sessionId: request.sessionId, message: userMessage, turnId });
      const response = await relay.requestImage(provider.mirrorCoding, request.modelId, request.prompt, options, references, controller.signal);
      if (!response.ok) {
        if (response.status === 401) throw new Error("reauthorization_required");
        if (response.status === 403) throw new Error("model_or_group_unavailable");
        if (response.status === 429) throw new Error("rate_limited");
        if (response.status === 503) throw new Error("service_unavailable");
        throw new Error("image_generation_failed");
      }
      const outputs = parseImageOutputs(await response.json());
      const images = await Promise.all(outputs.map((output, index) => persistImage(output, `${jobId}-${index + 1}`, controller.signal)));
      const result: ImageGenerationResult = { kind: "image-generation", model, prompt: request.prompt, options, images };
      const assistantMessage: UiMessage = {
        id: randomUUID(), role: "assistant", content: result.text ?? "", createdAt: new Date().toISOString(), status: "complete",
        providerId: request.providerId, modelId: request.modelId, imageGeneration: result,
        attachments: images.flatMap((image) => image.attachment ? [image.attachment] : []),
      };
      await host().call("session.appendMessage", { sessionId: request.sessionId, message: assistantMessage, turnId });
      await host().call("session.endTurn", { turnId, status: "completed" });
      return { jobId, turnId, userMessage, assistantMessage, result };
    } catch (error) {
      if (turnId) {
        await host().call("session.endTurn", {
          turnId,
          status: controller.signal.aborted ? "aborted" : "error",
          errorCode: controller.signal.aborted ? "TURN_ABORTED" : error instanceof Error ? error.message : "image_generation_failed",
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      imageJobs.delete(jobId);
    }
  };
  const abortImage = (jobId: string): boolean => {
    const controller = imageJobs.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  };
  return {
    account, relay, bindingFor, bindingForImage, isReady, completeWelcome, generateImage, abortImage,
    async start() { await account.initialize(); void account.refreshCatalog(); void account.retryRevocation(); },
    dispose() { account.dispose(); relay.dispose(); },
  };
}
export type MirrorCodingRuntime = ReturnType<typeof createMirrorCodingRuntime>;
