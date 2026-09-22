import { createImagesModels, createImagesProvider, type ImagesModel, type ImagesOutputContent } from "@earendil-works/pi-ai";
import { validateImageOptions, type MirrorImageBinding, type ImageGenerationOptions, type ImageOutput } from "@pi-desktop/shared";

export type ImageTask = { jobId: string; binding: MirrorImageBinding; prompt: string; options?: ImageGenerationOptions };

/** One-shot image requests use pi's image extension, independently of Agent. */
export class ImageTasks {
  private jobs = new Map<string, AbortController>();

  abort(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    job?.abort();
    return !!job;
  }

  async generate(task: ImageTask): Promise<{ outputs: ImageOutput[]; text?: string }> {
    if (this.jobs.has(task.jobId)) throw new Error("image_job_exists");
    const controller = new AbortController();
    this.jobs.set(task.jobId, controller);
    const { binding } = task;
    const options = validateImageOptions(binding.model.capability, task.options, binding.references.length);
    const model: ImagesModel<"mirrorcoding-images"> = {
      id: binding.model.modelId, name: binding.model.displayName, provider: binding.model.providerId,
      api: "mirrorcoding-images", baseUrl: binding.baseUrl, input: ["text", "image"], output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    // pi's image output carries inline pixels. Pending URLs remain transport
    // results for main to download and persist without account credentials.
    const outputs: ImageOutput[] = [];
    const models = createImagesModels();
    models.setProvider(createImagesProvider({
      id: model.provider, models: [model],
      auth: { apiKey: { name: "Local MirrorCoding relay", async resolve() { return { auth: { headers: binding.headers } }; } } },
      api: { async generateImages(selected, context, request) {
        const refs = context.input.filter((entry) => entry.type === "image");
        const path = refs.length ? binding.model.capability.reference_path! : binding.model.capability.generation_path;
        const response = await fetch(`${selected.baseUrl}${path}`, {
          method: "POST", signal: request?.signal,
          headers: { ...binding.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selected.id, prompt: context.input.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n"),
            n: options.count,
            ...(options.size ? { size: options.size } : {}),
            ...(options.quality ? { quality: options.quality } : {}),
            ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
            ...(refs.length ? { images: refs.map((ref) => ({ image_url: `data:${ref.mimeType};base64,${ref.data}` })) } : {}),
          }),
        });
        if (!response.ok) {
          const code = ({ 401: "reauthorization_required", 403: "model_or_group_unavailable", 429: "rate_limited", 503: "service_unavailable" } as Record<number, string>)[response.status];
          throw new Error(code ?? "image_generation_failed");
        }
        const value: unknown = await response.json();
        if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) throw new Error("invalid_image_response");
        const output: ImagesOutputContent[] = [];
        for (const item of (value as { data: unknown[] }).data) {
          if (!item || typeof item !== "object") continue;
          const row = item as Record<string, unknown>;
          const mimeType = typeof row.mime_type === "string" ? row.mime_type : "image/png";
          if (typeof row.b64_json === "string" && row.b64_json) {
            outputs.push({ data: row.b64_json, mimeType });
            output.push({ type: "image", data: row.b64_json, mimeType });
          } else if (typeof row.url === "string" && row.url) outputs.push({ url: row.url, mimeType });
        }
        if (!outputs.length) throw new Error("invalid_image_response");
        return { api: selected.api, provider: selected.provider, model: selected.id, output, stopReason: "stop", timestamp: Date.now() };
      } },
    }));
    try {
      const result = await models.generateImages(model, {
        input: [{ type: "text", text: task.prompt }, ...binding.references.map((ref) => ({ type: "image" as const, ...ref }))],
      }, { signal: controller.signal, maxRetries: 0 });
      if (controller.signal.aborted || result.stopReason === "aborted") throw new Error("image_aborted");
      if (result.stopReason === "error") throw new Error(result.errorMessage ?? "image_generation_failed");
      return { outputs };
    } finally { this.jobs.delete(task.jobId); }
  }
}
