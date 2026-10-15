import type { ImageGenerationResult, MessageAttachment, SessionDetail } from "@pi-desktop/shared";
import type { AgentSidecar } from "../agent-sidecar";
import type { HostProcess } from "../host-process";
import type { ImageService } from "./service";
import { validateImageRequest } from "./ipc";

export function registerImageTools(sidecar: AgentSidecar, images: ImageService, getHost: () => HostProcess | null): void {
  const references = async (sessionId: string) => {
    const host = getHost();
    if (!host) throw new Error("host_unavailable");
    const { session } = await host.call<{ session: SessionDetail }>("session.get", { id: sessionId });
    const refs = new Map<string, { id: string; messageId: string; attachment: MessageAttachment }>();
    for (const message of session.messages) {
      const add = (attachment: MessageAttachment) => {
        if (attachment.kind === "image") refs.set(attachment.ref, { id: attachment.ref, messageId: message.id, attachment });
      };
      message.attachments?.forEach(add);
      const result = message.imageGeneration ?? toolImages(message.toolResult);
      result?.images.forEach((image) => { if (image.attachment) add(image.attachment); });
    }
    return [...refs.values()];
  };
  sidecar.setLocalTool("ListImageModels", async ({ sessionId }) => ({ ok: true, content: {
    models: await images.models(true), references: (await references(sessionId)).map((ref) => ({ id: ref.id, messageId: ref.messageId, name: ref.attachment.name })),
  } }));
  sidecar.setLocalTool("GenerateImage", async ({ sessionId, toolCallId, args, signal }) => {
    const row = args && typeof args === "object" ? args as Record<string, unknown> : {};
    const referenceIds = row.referenceIds ?? [];
    if (!Array.isArray(referenceIds) || !referenceIds.every((id) => typeof id === "string")) throw new Error("invalid_image_request");
    const known = await references(sessionId);
    const selected = referenceIds.map((id) => {
      const ref = known.find((ref) => ref.id === id);
      if (!ref) throw new Error("image_reference_unavailable");
      return { path: ref.attachment.ref, name: ref.attachment.name, kind: "image", mimeType: ref.attachment.mimeType };
    });
    const jobId = `${sessionId}:${toolCallId}`;
    const abort = () => { images.abort(jobId); };
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const request = validateImageRequest({ sessionId, jobId, providerId: row.providerId, modelId: row.modelId, prompt: row.prompt, options: row.options, references: selected });
      const { result } = await images.generate(request, false);
      return { ok: true, content: result };
    } finally { signal.removeEventListener("abort", abort); }
  });
}

function toolImages(value: unknown): ImageGenerationResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { kind?: string; details?: unknown; content?: unknown };
  if (row.kind === "image-generation") return value as ImageGenerationResult;
  return toolImages(row.details) ?? toolImages(row.content);
}
