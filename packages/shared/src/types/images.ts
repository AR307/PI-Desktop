import type { AgentPromptAttachment } from "./agent.js";
import type { MessageAttachment } from "./messages.js";

export const STANDARD_IMAGE_GENERATION_PATH = "/v1/images/generations";
export const STANDARD_IMAGE_EDIT_PATH = "/v1/images/edits";

export type ImageGenerationCapability = {
  generation_path: string;
  reference_path?: typeof STANDARD_IMAGE_GENERATION_PATH | typeof STANDARD_IMAGE_EDIT_PATH;
  sizes?: string[];
  qualities?: string[];
  aspect_ratios?: string[];
  max_count: number;
  supports_chat: boolean;
  /** False when the account route is not an OpenAI images generations or edits path. */
  sendable?: boolean;
};

export function imageCapabilitySendable(
  capability: Pick<ImageGenerationCapability, "generation_path" | "sendable"> | undefined,
): boolean {
  if (!capability) return false;
  if (capability.sendable === false) return false;
  if (capability.sendable === true) return true;
  return capability.generation_path === STANDARD_IMAGE_GENERATION_PATH
    || capability.generation_path === STANDARD_IMAGE_EDIT_PATH;
}

export type ImageGenerationOptions = { size?: string; quality?: string; aspectRatio?: string; count?: number };
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
  jobId?: string;
  /** Shared identity for a mobile optimistic row and its durable desktop message. */
  messageId?: string;
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
  error?: string;
};
export type MirrorImageBinding = {
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
  if (options.aspectRatio && !capability.aspect_ratios?.includes(options.aspectRatio)) throw new Error("images_ratio_unsupported");
  if (options.quality && !capability.qualities?.includes(options.quality)) throw new Error("images_quality_unsupported");
  const count = options.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > capability.max_count) throw new Error("images_count_unsupported");
  return {
    count,
    ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    ...(options.size ? { size: options.size } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
  };
}

function standardReferencePath(value: unknown): ImageGenerationCapability["reference_path"] | undefined {
  if (value === STANDARD_IMAGE_GENERATION_PATH || value === STANDARD_IMAGE_EDIT_PATH) return value;
  return undefined;
}

export function parseImageCapability(value: unknown): ImageGenerationCapability {
  if (!value || typeof value !== "object") throw new Error("invalid_image_capability");
  const row = value as Record<string, unknown>;
  if (typeof row.generation_path !== "string" || row.generation_path.length === 0 || row.generation_path.length > 512 ||
      (row.reference_path !== undefined && typeof row.reference_path !== "string") ||
      !Number.isSafeInteger(row.max_count) || Number(row.max_count) < 1 ||
      typeof row.supports_chat !== "boolean") throw new Error("invalid_image_capability");
  const list = (input: unknown): string[] | undefined => {
    if (input === undefined) return undefined;
    if (!Array.isArray(input) || !input.every((entry): entry is string => typeof entry === "string" && entry.length > 0)) throw new Error("invalid_image_capability");
    return [...new Set(input)];
  };
  const generation_path = row.generation_path;
  const reference_path = standardReferencePath(row.reference_path);
  return {
    generation_path,
    ...(reference_path ? { reference_path } : {}),
    sizes: list(row.sizes), qualities: list(row.qualities), aspect_ratios: list(row.aspect_ratios),
    max_count: Number(row.max_count), supports_chat: row.supports_chat,
    sendable: generation_path === STANDARD_IMAGE_GENERATION_PATH || generation_path === STANDARD_IMAGE_EDIT_PATH,
  };
}
