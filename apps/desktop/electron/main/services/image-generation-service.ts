import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createImageBinding, generateImageBatch, type ImageOperationMetadata, type ImageEndpoint } from "@pi-desktop/agent-runtime";
import type { ImageApi, ImageModel } from "@earendil-works/pi-ai";
import type { VendorOAuth } from "../oauth";
import {
  imageGenerationPrompts,
  imageGenerationItems,
  parseImageGenerationBinding,
  type AppSettings,
  type ProviderPublic,
} from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { LocalToolHandler } from "../agent-sidecar";
import type { MirrorCodingRuntime } from "../mirrorcoding/runtime";
import { imageInputLoader } from "./image-inputs";

function failure(errorCode: string, content: string) {
  return {
    ok: false,
    isError: true,
    errorCode,
    content: { kind: "image-generation-error", errorCode, message: content },
  };
}

export function createImageGenerationTool(options: {
  dataDir: string;
  getHost: () => Pick<HostProcess, "call"> | null;
  fetchImpl?: typeof fetch;
  allowFakeIp?: () => boolean;
  mirrorCoding?: MirrorCodingRuntime;
  resolveAuth?: VendorOAuth["resolveAuth"];
  resolveImageModel?: (provider: ProviderPublic, modelId: string) => Promise<ImageModel<ImageApi> | undefined>;
}): LocalToolHandler {
  return async ({ sessionId, args, signal }) => {
    imageGenerationPrompts(args);
    const host = options.getHost();
    if (!host) return failure("HOST_UNAVAILABLE", "Host unavailable.");
    const settings = await host.call<AppSettings>("settings.get");
    const binding = parseImageGenerationBinding(settings.imageGeneration);
    if (!binding)
      return failure(
        "IMAGE_NOT_CONFIGURED",
        "Configure an image generation model in Settings > Models > Image generation model before generating images. Do not substitute another model.",
      );
    const { provider } = await host.call<{ provider?: ProviderPublic }>("providers.get", {
      id: binding.providerId,
    });
    if (
      !provider?.enabled ||
      !provider.baseUrl ||
      !provider.models.some((model) => model.id === binding.modelId)
    ) {
      return failure(
        "IMAGE_MODEL_UNAVAILABLE",
        "The configured image model is unavailable. Update Settings > Models > Image generation model.",
      );
    }
    const downloadOptions = { allowFakeIp: options.allowFakeIp?.() === true };
    let endpoint: ImageEndpoint;
    if (provider.authKind === "mirrorcoding") {
      const items = imageGenerationItems(args);
      const hasReferenceImages = items.some(item => Boolean(item.images?.length));
      if (hasReferenceImages && items.some(item => !item.images?.length))
        return failure("IMAGE_INVALID_INPUT", "A generation batch cannot mix reference-image and text-only items.");
      if (!options.mirrorCoding) return failure("IMAGE_AUTH_FAILED", "MirrorCoding is not available.");
      try {
        const bound = await options.mirrorCoding.bindingForImage(provider.id, binding.modelId, sessionId, hasReferenceImages);
        endpoint = { providerId: provider.id, baseUrl: bound.baseUrl!, modelId: bound.modelId, apiKey: bound.apiKey, headers: bound.headers, jsonImages: true };
      } catch (error) {
        const unavailable = error instanceof Error && error.message === "model_or_group_unavailable";
        return failure(unavailable ? "IMAGE_MODEL_UNAVAILABLE" : "IMAGE_AUTH_FAILED", unavailable ? "The configured MirrorCoding image model or group is unavailable." : "MirrorCoding authorization is required.");
      }
    } else {
      const { value } = provider.authKind === "oauth" || provider.authKind === "none"
        ? { value: undefined }
        : await host.call<{ value?: string }>("providers.getSecret", { id: provider.id });
      if (provider.authKind !== "none" && provider.authKind !== "oauth" && !value)
        return failure("IMAGE_AUTH_FAILED", "The image provider needs an API key.");
      endpoint = {
        nativeModel: await options.resolveImageModel?.(provider, binding.modelId),
        providerId: provider.id, vendorKey: provider.vendorKey, authKind: provider.authKind,
        baseUrl: provider.baseUrl, modelId: binding.modelId, apiKey: value, headers: provider.headers,
        ...(provider.authKind === "oauth" && options.resolveAuth ? { resolveAuth: () => options.resolveAuth!(provider.id) } : {}),
      };
    }
    let imageBinding;
    try {
      imageBinding = createImageBinding(endpoint, downloadOptions);
    } catch (error) {
      if (error && typeof error === "object" && "errorCode" in error && error.errorCode === "IMAGE_AUTH_UNSUPPORTED")
        return failure("IMAGE_AUTH_UNSUPPORTED", "The selected account has no supported image operation.");
      throw error;
    }
    const { path } = await host.call<{ path: string }>("session.getScratchPath", { sessionId });
    const root = resolve(options.dataDir, "scratch");
    const within = (base: string, target: string) => {
      const rel = relative(base, target);
      return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
    };
    if (typeof path !== "string" || !within(root, resolve(path)))
      return failure("INVALID_ARGUMENT", "Invalid image output directory.");
    await mkdir(path, { recursive: true });
    const realRoot = await realpath(root);
    const realDir = await realpath(path);
    if (!within(realRoot, realDir))
      return failure("INVALID_ARGUMENT", "Invalid image output directory.");
    signal.throwIfAborted();
    const { session } = await host.call<{ session?: { projectPath?: string } }>("session.get", {
      id: sessionId,
    });
    if (!session) return failure("SESSION_NOT_FOUND", "The image session no longer exists.");
    const operations: ImageOperationMetadata[] = [];
    const results = await generateImageBatch({
      input: args,
      binding: imageBinding,
      onOperation: operation => { operations.push(operation); },
      signal,
      fetchImpl: options.fetchImpl,
      downloadOptions: { allowFakeIp: options.allowFakeIp?.() === true },
      loadImages: imageInputLoader({
        dataDir: options.dataDir,
        scratchPath: realDir,
        projectPath: session?.projectPath,
      }),
      save: async (image) => {
        const target = join(realDir, `generated-${randomUUID()}.${image.extension}`);
        await writeFile(target, image.bytes, { flag: "wx" });
        return target;
      },
    });
    const ok = results.some((result) => result.status === "succeeded");
    return {
      ok,
      isError: !ok,
      content: {
        kind: "generated-images",
        providerId: binding.providerId,
        modelId: binding.modelId,
        results,
        operations: operations.sort((a, b) => a.index - b.index),
      },
    };
  };
}
