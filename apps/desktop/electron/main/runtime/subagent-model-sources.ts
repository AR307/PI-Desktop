import { mirrorCodingChatAvailable, type ModelBinding } from "@pi-desktop/shared";
import { findSubagentProviderSource, subagentProviderLookupError } from "@pi-desktop/agent-runtime";

import type { RuntimeProvider } from "./provider-catalog";

type Source = { key: string; provider: RuntimeProvider; model: ModelBinding };

/** Account models own opt-in/settings; MC group providers own request routing. */
export function subagentModelSources(providers: RuntimeProvider[]): Source[] {
  const enabled = providers.filter((row) => row.enabled);
  const result: Source[] = [];
  for (const owner of enabled) {
    if (owner.authKind === "mirrorcoding" && owner.mirrorCoding?.scope !== "account") continue;
    for (const model of owner.models ?? []) {
      if (!model.availableForSubagents) continue;
      if (owner.authKind === "mirrorcoding") {
        for (const group of enabled) {
          if (group.authKind !== "mirrorcoding" || group.mirrorCoding?.scope !== "group" ||
              group.mirrorCoding.accountId !== owner.mirrorCoding?.accountId ||
              !mirrorCodingChatAvailable(owner.mirrorCoding, model.id, group.mirrorCoding.groupId) ||
              !mirrorCodingChatAvailable(group.mirrorCoding, model.id)) continue;
          result.push({ key: group.id + "/" + model.id, provider: group, model });
        }
      } else {
        result.push({ key: owner.id + "/" + model.id, provider: owner, model });
      }
    }
  }
  return result;
}

export function resolveSubagentModelSource(providers: RuntimeProvider[], providerPart: string, modelId: string): Source {
  const exact = providers.find((row) => row.id === providerPart);
  const provider = exact ?? findSubagentProviderSource(providerPart,
    providers.filter((row) => row.authKind !== "mirrorcoding" || row.mirrorCoding?.scope === "account"));
  if (!provider) throw new Error(subagentProviderLookupError(providerPart, providers));
  const sources = subagentModelSources(providers).filter((source) => source.model.id === modelId);
  const matches = provider.authKind === "mirrorcoding" && provider.mirrorCoding?.scope === "account"
    ? sources.filter((source) => source.provider.mirrorCoding?.accountId === provider.mirrorCoding?.accountId)
    : sources.filter((source) => source.provider.id === provider.id);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('Choose a channel explicitly for "' + modelId + '": ' + matches.map((source) => source.key + ' (' + source.provider.name + ')').join(', '));
  throw new Error('Model "' + modelId + '" on "' + provider.name + '" is unavailable or not enabled for subagents. Enable it in model settings and choose an available channel.');
}
