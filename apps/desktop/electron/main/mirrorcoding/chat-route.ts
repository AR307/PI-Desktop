import type { MirrorCodingCatalog, MirrorCodingEndpoint, MirrorCodingModel } from "@pi-desktop/shared";

/** Only catalog permissions authorize a protocol, never the model name. */
export function mirrorCodingChatRoute(
  model: MirrorCodingModel,
  endpoints: MirrorCodingCatalog["supportedEndpoints"],
  preferred?: MirrorCodingEndpoint,
): MirrorCodingEndpoint | undefined {
  if (!model.modes.includes("text")) return undefined;
  const order: MirrorCodingEndpoint[] = ["openai-response", "openai", "anthropic", "gemini"];
  return [...(preferred ? [preferred] : []), ...order].find(kind =>
    model.supportedEndpointTypes.includes(kind) && endpoints[kind]?.method === "POST" &&
    isMirrorCodingEndpointPath(endpoints[kind].path));
}

export function isMirrorCodingEndpointPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !/[\\?#\s]/.test(path);
}
