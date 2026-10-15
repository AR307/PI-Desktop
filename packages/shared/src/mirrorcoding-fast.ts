import type { MirrorCodingProvider, MirrorCodingGroupRoute } from "./types/mirrorcoding.js";

/** The account union is a settings projection, never a permission union. */
export function mirrorCodingGroupForModel(
  metadata: MirrorCodingProvider,
  groupId?: string,
): MirrorCodingProvider | MirrorCodingGroupRoute | undefined {
  if (metadata.scope === "account") return metadata.groups?.find(group => group.id === groupId);
  return !groupId || groupId === metadata.groupId ? metadata : undefined;
}

export function mirrorCodingChatAvailable(metadata: MirrorCodingProvider | undefined, modelId: string, groupId?: string): boolean {
  if (!metadata) return false;
  const group = mirrorCodingGroupForModel(metadata, groupId);
  return Boolean(group?.routes[modelId] && group.modelCapabilities?.[modelId]?.modes.includes("text"));
}

export function mirrorCodingFastAvailable(metadata: MirrorCodingProvider | undefined, modelId: string, groupId?: string): boolean {
  if (!metadata) return false;
  const group = mirrorCodingGroupForModel(metadata, groupId);
  const endpoint = group?.routes[modelId];
  const capability = group?.modelCapabilities?.[modelId];
  return Boolean((endpoint === "openai" || endpoint === "openai-response") &&
    capability?.modes.includes("text") && capability.fast?.enabled &&
    capability.fast.supportedEndpointTypes.includes(endpoint));
}
