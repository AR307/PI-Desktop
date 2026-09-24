import type {
  ImageModelInfo,
  MobileModelCatalog,
  MobileModelChoice,
  MirrorCodingProvider,
  ModelBinding,
  ProviderPublic, ModelModality,
} from "@pi-desktop/shared";
import type { HostRpc } from "@pi-desktop/host-runtime";
import type { ImageService } from "../images/service";

type CatalogDependencies = {
  host(): HostRpc;
  images: ImageService;
  isMirrorCodingReady(provider: MirrorCodingProvider): boolean;
};

/**
 * Build the deliberately small model projection used by the phone. Provider
 * secrets, base URLs and transport details never cross this boundary.
 */
export async function buildMobileModelCatalog({ host, images, isMirrorCodingReady }: CatalogDependencies): Promise<MobileModelCatalog> {
  const [{ providers }, imageModels] = await Promise.all([
    host().call<{ providers: ProviderPublic[] }>("providers.list", { includeDisabled: false }),
    images.models(),
  ]);
  const chat: MobileModelChoice[] = [];
  for (const provider of providers ?? []) {
    if (!provider.enabled || provider.mirrorCoding?.scope === "account" || (provider.mirrorCoding
      ? !isMirrorCodingReady(provider.mirrorCoding)
      : !provider.hasSecret && !provider.hasOauth && provider.authKind !== "none")) continue;
    const bindings = normalizedBindings(provider);
    for (const binding of bindings) {
      const legacyGroup = provider.mirrorCoding;
      const mirrorRoute = legacyGroup?.routes[binding.id];
      if (provider.mirrorCoding && !mirrorRoute) continue;
      const image = legacyGroup?.imageModels?.[binding.id];
      const modalitiesInput: ModelModality[] = ["text"];
      if (binding.supportsImages === true) modalitiesInput.push("image");
      chat.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: binding.id,
        displayName: binding.alias || binding.id,
        source: provider.mirrorCoding ? "mirrorcoding" : "provider",
        ...(provider.mirrorCoding ? {
          groupId: provider.mirrorCoding.groupId,
          groupName: provider.mirrorCoding.groupName,
          groupDescription: provider.mirrorCoding.description,
          ratio: provider.mirrorCoding.ratio,
          dynamicBilling: provider.mirrorCoding.dynamicBilling,
        } : {}),
        supportsReasoning: provider.supportsReasoning || binding.thinkingLevels.some((level) => level !== "off"),
        supportedThinkingLevels: [...new Set(binding.thinkingLevels.length ? binding.thinkingLevels : provider.supportedThinkingLevels)],
        supportsVision: binding.supportsImages === true || provider.supportsVision === true,
        ...(image ? { image } : {}),
        ...(mirrorRoute ? { modalities: { input: modalitiesInput, output: ["text"] as ModelModality[] } } : {}),
      });
    }
  }
  const image = imageModels.map((model) => imageChoice(model));
  return { chat: dedupeChoices(chat), image: dedupeChoices(image) };
}

function normalizedBindings(provider: ProviderPublic): ModelBinding[] {
  if (provider.models.length) return provider.models;
  const id = provider.defaultModelId;
  if (!id) return [];
  return [{
    id,
    contextWindow: provider.contextWindow ?? 0,
    maxTokens: provider.maxOutputTokens ?? 0,
    thinkingLevels: provider.supportedThinkingLevels,
    defaultThinkingLevel: provider.supportsReasoning ? "medium" : "off",
  }];
}

function imageChoice(model: ImageModelInfo): MobileModelChoice {
  const input: ModelModality[] = ["text"];
  if (model.capability.reference_path) input.push("image");
  return {
    providerId: model.providerId,
    providerName: "MirrorCoding",
    modelId: model.modelId,
    displayName: model.displayName,
    source: "mirrorcoding",
    groupName: model.groupName,
    groupDescription: model.description,
    ratio: model.ratio,
    dynamicBilling: model.dynamicBilling,
    supportsReasoning: false,
    supportedThinkingLevels: ["off"],
    supportsVision: Boolean(model.capability.reference_path),
    modalities: { input, output: ["image"] },
    image: model.capability,
  };
}

function dedupeChoices(choices: MobileModelChoice[]): MobileModelChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = `${choice.providerId}\u0000${choice.modelId}\u0000${choice.groupId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
