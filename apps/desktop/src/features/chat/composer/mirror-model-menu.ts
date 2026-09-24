import type { ProviderPublic } from "@pi-desktop/shared";

type MenuGroup<TModel extends { modelId: string }> = {
  provider: Pick<ProviderPublic, "mirrorCoding">;
  providerDisplayName: string;
  providerSearchText: string;
  models: TModel[];
};

/** Collapse managed groups to one visible row per model ID. */
export function collapseMirrorCodingGroups<
  TModel extends { modelId: string },
  TGroup extends MenuGroup<TModel>,
>(groups: readonly TGroup[]): TGroup[] {
  const managed = groups.filter((group) => group.provider.mirrorCoding);
  const regular = groups.filter((group) => !group.provider.mirrorCoding);
  if (!managed.length) return [...regular];
  const seen = new Set<string>();
  const models = managed.flatMap((group) => group.models).filter((model) => {
    if (seen.has(model.modelId)) return false;
    seen.add(model.modelId);
    return true;
  });
  const first = managed[0]!;
  return [{
    ...first,
    providerDisplayName: "MirrorCoding",
    providerSearchText: "mirrorcoding",
    models,
  }, ...regular];
}

export function mirrorGroupsForModel<
  TModel extends { modelId: string },
  TGroup extends MenuGroup<TModel>,
>(groups: readonly TGroup[], modelId: string | null | undefined): TGroup[] {
  if (!modelId) return [];
  return groups.filter((group) =>
    Boolean(group.provider.mirrorCoding) &&
    group.models.some((model) => model.modelId === modelId),
  );
}
