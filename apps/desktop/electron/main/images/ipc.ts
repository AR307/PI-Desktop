import { IPC, type ImageGenerationRequest, type ImageSessionConfig } from "@pi-desktop/shared";
import type { IpcRegistrar } from "../ipc/types";
import type { ImageService } from "./service";

export function validateImageRequest(input: unknown): ImageGenerationRequest {
  if (!input || typeof input !== "object") throw new Error("invalid_image_request");
  const row = input as Record<string, unknown>;
  for (const name of ["sessionId", "providerId", "modelId", "prompt"]) if (typeof row[name] !== "string" || !row[name].trim()) throw new Error("invalid_image_request");
  if (row.jobId !== undefined && typeof row.jobId !== "string") throw new Error("invalid_image_request");
  if (row.options !== undefined && (!row.options || typeof row.options !== "object" || Array.isArray(row.options))) throw new Error("invalid_image_request");
  if (row.references !== undefined && (!Array.isArray(row.references) || !row.references.every((ref: unknown) => {
    if (!ref || typeof ref !== "object") return false;
    const item = ref as Record<string, unknown>;
    return typeof item.path === "string" && typeof item.name === "string" && item.kind === "image";
  }))) throw new Error("invalid_image_request");
  return row as ImageGenerationRequest;
}

export function registerImageIpc(registrar: IpcRegistrar, images: ImageService): void {
  const handle = (channel: string, fn: (input: unknown) => unknown) => registrar.handleWithEvent(channel, async (event, input: unknown) => {
    registrar.assertMainWindowSender(event);
    return fn(input);
  });
  handle(IPC.invoke.imageGenerate, (input) => images.generate(validateImageRequest(input)));
  handle(IPC.invoke.imageAbort, (jobId) => {
    if (typeof jobId !== "string") throw new Error("invalid_image_request");
    return { aborted: images.abort(jobId) };
  });
  handle(IPC.invoke.imageModels, () => images.models());
  handle(IPC.invoke.imageJobs, () => images.states());
  handle(IPC.invoke.imageConfigure, (input) => {
    const row = input as { key?: unknown; config?: ImageSessionConfig } | null;
    if (!row || typeof row.key !== "string" || !row.config) throw new Error("invalid_image_request");
    return images.configure(row.key, row.config);
  });
  handle(IPC.invoke.imageRetryDownload, (input) => {
    const row = input as Record<string, unknown> | null;
    if (!row || typeof row.sessionId !== "string" || typeof row.messageId !== "string" || typeof row.imageId !== "string") throw new Error("invalid_image_request");
    return images.retryDownload(row.sessionId, row.messageId, row.imageId);
  });
}
