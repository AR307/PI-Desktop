import type { MirrorCodingEndpoint } from "@pi-desktop/shared";

export const isMirrorCodingClaudeModel = (modelId: string): boolean => modelId.toLowerCase().includes("claude");

/** MC chat policy uses the original catalog ID, never a display name. */
export function mirrorCodingChatRoute(
  modelId: string,
  route: MirrorCodingEndpoint | undefined,
  isChatModel = route !== undefined,
): MirrorCodingEndpoint | undefined {
  return isChatModel && isMirrorCodingClaudeModel(modelId) ? "anthropic" : route;
}
