import { supportsClaudeCacheTtl, type ProviderPublic } from "@pi-desktop/shared";
import { composerModelBinding } from "../../../lib/composer-models";

/** Account settings own MirrorCoding bindings; group rows are projections. */
export function composerClaudeCacheTarget(
  providers: readonly ProviderPublic[],
  providerId: string | undefined,
  modelId: string | undefined,
  family?: string,
) {
  const selected = providers.find((provider) => provider.id === providerId);
  if (!selected?.enabled || !modelId || selected.ownerPluginId) return undefined;
  const provider = selected.mirrorCoding
    ? providers.find((candidate) => candidate.mirrorCoding?.scope === "account" &&
        candidate.mirrorCoding.accountId === selected.mirrorCoding?.accountId)
    : selected;
  if (!provider || provider.ownerPluginId) return undefined;
  const binding = composerModelBinding(provider, modelId);
  if (!binding) return undefined;
  const route = selected.mirrorCoding?.routes[binding.id];
  const apiStyle = route ? (route === "anthropic" ? "anthropic_messages" : route)
    : binding.apiStyle ?? selected.apiStyle;
  if (!supportsClaudeCacheTtl(binding.id, apiStyle, family)) return undefined;
  return { provider, binding };
}
