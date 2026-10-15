import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo, ModelBinding, ProviderPublic } from "@pi-desktop/shared";
import { Button } from "../ui";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { ModelSelectionPanes, useModelSelection } from "./ModelSelectionPanes";
import type { ProviderModelsState } from "./useProviderModels";
import { SettingsMenuSelect } from "./SettingsMenuSelect";

function modelInfoFromBinding(providerId: string, binding: ModelBinding): ModelInfo {
  const input: Array<"text" | "image" | "pdf"> = ["text"];
  if (binding.supportsImages === true) input.push("image");
  if (binding.supportsDocuments === true) input.push("pdf");
  const reasoning = binding.thinkingLevels.some((level) => level !== "off");
  return {
    modelId: binding.id,
    displayName: binding.alias?.trim() || binding.id,
    providerId,
    capabilities: [
      "text",
      ...(reasoning ? ["reasoning" as const] : []),
      ...(binding.supportsImages === true ? ["vision" as const] : []),
      ...(binding.supportsDocuments === true ? ["pdf" as const] : []),
      ...(binding.temperature !== undefined ? ["temperature" as const] : []),
    ],
    source: "user",
    contextWindow: binding.contextWindow,
    maxTokens: binding.maxTokens,
    reasoning,
    supportedThinkingLevels: [...binding.thinkingLevels],
    modalities: { input, output: ["text"] },
  };
}

function groupsForModel(provider: ProviderPublic, modelId: string) {
  return (provider.mirrorCoding?.groups ?? []).filter((group) =>
    Boolean(group.routes[modelId] || group.imageRoutes?.[modelId] || group.imageModels?.[modelId]),
  );
}

export function MirrorCodingModelConfigs({ providers }: { providers: ProviderPublic[] }) {
  const { t } = useTranslation();
  const refreshProviders = useAppStore((state) => state.refreshProviders);
  const showToast = useAppStore((state) => state.showToast);
  const accountProvider = useMemo(
    () => providers.find((provider) => provider.authKind === "mirrorcoding" && provider.mirrorCoding?.scope === "account"),
    [providers],
  );
  const [models, setModels] = useState<ModelBinding[]>(accountProvider?.models ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setModels(accountProvider?.models ?? []);
  }, [accountProvider?.id, accountProvider?.updatedAt]);

  const discovery = useMemo<ProviderModelsState>(() => ({
    status: accountProvider ? "ready" : "idle",
    models: accountProvider
      ? accountProvider.models.map((binding) => modelInfoFromBinding(accountProvider.id, binding))
      : [],
    ...(accountProvider ? { source: "remote" as const } : {}),
  }), [accountProvider]);
  const selection = useModelSelection(discovery, models, setModels);

  const save = async () => {
    if (!accountProvider) return;
    setSaving(true);
    try {
      await api.updateProvider({
        id: accountProvider.id,
        models: selection.bindingsToPersist,
      });
      await refreshProviders();
      showToast(t("settings.providerSaved"), { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const renderBindingExtra = (
    binding: ModelBinding,
    updateBinding: (id: string, update: Partial<ModelBinding>) => void,
    busy: boolean,
  ) => {
    if (!accountProvider) return null;
    const groups = groupsForModel(accountProvider, binding.id);
    if (groups.length === 0) return null;
    return (
      <div className="mirrorcoding-binding-group">
        <span className="provider-chosen-field-label">{t("mirrorCoding.chooseGroup")}</span>
        <SettingsMenuSelect
          fullWidth
          label={t("mirrorCoding.chooseGroup")}
          value={binding.mirrorCodingGroupId ?? groups[0]!.id}
          disabled={busy}
          options={groups.map((group) => ({
            id: group.id,
            label: group.dynamicBilling || group.ratio == null
              ? `${group.name} · ${t("mirrorCoding.dynamic")}`
              : `${group.name} · ${group.ratio}×`,
          }))}
          onChange={(id) => updateBinding(binding.id, { mirrorCodingGroupId: id })}
        />
      </div>
    );
  };

  return (
    <section className="settings-card-block mirrorcoding-model-configs">
      <div className="model-config-section-head">
        <div>
          <h3 className="settings-card-heading">{t("settings.modelConfigurations")}</h3>
          <p className="settings-row-detail">{t("mirrorCoding.description")}</p>
        </div>
        <span className="provider-section-count">{selection.models.length}</span>
      </div>
      <div className="settings-panel mirrorcoding-model-config-panel">
        {accountProvider ? (
          <ModelSelectionPanes
            discovery={{ ...discovery, canReload: false }}
            selection={selection}
            listTitle={t("settings.serviceModels")}
            busy={saving}
            renderBindingExtra={renderBindingExtra}
            allowCustomModels={false}
          />
        ) : (
          <div className="mirrorcoding-model-config-empty" role="status">
            {t("mirrorCoding.empty")}
          </div>
        )}
        {accountProvider ? (
          <div className="mirrorcoding-model-config-actions">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
