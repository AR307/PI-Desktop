import type { AgentPromptAttachment } from "./agent.js";
import type { MessageAttachment } from "./messages.js";

export type ImageGenerationCapability = {
  generation_path: "/v1/images/generations";
  reference_path?: "/v1/images/generations" | "/v1/images/edits";
  sizes?: string[];
  qualities?: string[];
  max_count: number;
  supports_chat: boolean;
};

export type ImageGenerationOptions = { size?: string; quality?: string; count?: number };
export type ImageSessionConfig = {
  active: boolean;
  providerId?: string;
  modelId?: string;
  options: ImageGenerationOptions;
};
export type ImageModelInfo = {
  providerId: string;
  modelId: string;
  displayName: string;
  groupName: string;
  description: string;
  ratio: number | null;
  dynamicBilling: boolean;
  capability: ImageGenerationCapability;
};
export type ImageGenerationRequest = {
  sessionId: string;
  providerId: string;
  modelId: string;
  prompt: string;
  references?: AgentPromptAttachment[];
  options?: ImageGenerationOptions;
};
export type GeneratedImage = {
  id: string;
  attachment?: MessageAttachment;
  /** Only pending downloads retain their source URL; never used as model auth. */
  downloadUrl?: string;
  error?: string;
};
export type ImageGenerationResult = {
  kind: "image-generation";
  model: ImageModelInfo;
  prompt: string;
  options: ImageGenerationOptions;
  images: GeneratedImage[];
  text?: string;
};
export type ImageGenerationBinding = {
  model: ImageModelInfo;
  baseUrl: string;
  headers: Record<string, string>;
  references: Array<{ data: string; mimeType: string }>;
};
export type ImageOutput = { data?: string; url?: string; mimeType?: string };
export type ImageGenerationState = {
  sessionId: string;
  jobId: string;
  status: "running" | "complete" | "error" | "aborted";
  error?: string;
};

/** Keep manual selection, tool selection and wire serialization on one contract. */
export function validateImageOptions(
  capability: ImageGenerationCapability,
  options: ImageGenerationOptions = {},
  referenceCount = 0,
): ImageGenerationOptions {
  if (referenceCount && !capability.reference_path) throw new Error("images_reference_unsupported");
  if (options.size && !capability.sizes?.includes(options.size)) throw new Error("images_size_unsupported");
  if (options.quality && !capability.qualities?.includes(options.quality)) throw new Error("images_quality_unsupported");
  const count = options.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > capability.max_count) throw new Error("images_count_unsupported");
  return {
    count,
    ...(options.size ? { size: options.size } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
  };
}

export function parseImageCapability(value: unknown): ImageGenerationCapability {
  if (!value || typeof value !== "object") throw new Error("invalid_image_capability");
  const row = value as Record<string, unknown>;
  if (row.generation_path !== "/v1/images/generations" ||
      (row.reference_path !== undefined && row.reference_path !== "/v1/images/edits" && row.reference_path !== "/v1/images/generations") ||
      !Number.isSafeInteger(row.max_count) || Number(row.max_count) < 1 ||
      typeof row.supports_chat !== "boolean") throw new Error("invalid_image_capability");
  const list = (input: unknown): string[] | undefined => {
    if (input === undefined) return undefined;
    if (!Array.isArray(input) || !input.every((entry): entry is string => typeof entry === "string" && entry.length > 0)) throw new Error("invalid_image_capability");
    return [...new Set(input)];
  };
  return {
    generation_path: row.generation_path,
    ...(row.reference_path ? { reference_path: row.reference_path } : {}),
    sizes: list(row.sizes), qualities: list(row.qualities),
    max_count: Number(row.max_count), supports_chat: row.supports_chat,
  };
}
