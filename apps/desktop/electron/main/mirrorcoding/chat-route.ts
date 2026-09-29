import type { MirrorCodingEndpoint } from "@pi-desktop/shared";

/** MC chat policy uses the original catalog ID, never a display name. */
export function mirrorCodingChatRoute(
  modelId: string,
  route: MirrorCodingEndpoint | undefined,
): MirrorCodingEndpoint | undefined {
  if (!route) return undefined;
  return modelId.toLowerCase().includes("claude") ? "anthropic" : route;
}
