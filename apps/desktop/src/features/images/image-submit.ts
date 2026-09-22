import {
  imageCapabilitySendable,
  type ImageGenerationCapability,
  type ImageGenerationOptions,
} from "@pi-desktop/shared";

/** Account image models are usable without a copied API key. */
export function imageComposerReady(
  provider: { enabled: boolean } | undefined,
  capability: ImageGenerationCapability | undefined,
): boolean {
  return !!(provider?.enabled && capability && imageCapabilitySendable(capability));
}

/** Upstream image requests carry a count only. Size, quality and ratio stay off the wire. */
export function imageSubmitOptions(
  capability: ImageGenerationCapability,
  options: ImageGenerationOptions,
  referenceCount: number,
): ImageGenerationOptions {
  if (!imageCapabilitySendable(capability)) throw new Error("model_or_group_unavailable");
  if (referenceCount && !capability.reference_path) throw new Error("images_reference_unsupported");
  const count = options.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > capability.max_count) throw new Error("images_count_unsupported");
  return { count };
}
