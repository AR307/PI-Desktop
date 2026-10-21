import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelBinding } from "@pi-desktop/shared";
import { HelpIcon, SegmentedControl } from "../../../components/ui";
import { api } from "../../../lib/api";
import { sameComposerModelId } from "../../../lib/composer-models";
import { useAppStore } from "../../../stores/app-store";
import { composerClaudeCacheTarget } from "./claude-cache-target";

export function ComposerClaudeCache({ providerId, modelId, disabled }: {
  providerId?: string;
  modelId?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers);
  const family = useAppStore((state) => state.providerModels[providerId ?? ""]
    ?.find((model) => sameComposerModelId(model.modelId, modelId ?? ""))?.family);
  const refreshProviders = useAppStore((state) => state.refreshProviders);
  const showToast = useAppStore((state) => state.showToast);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const target = composerClaudeCacheTarget(providers, providerId, modelId, family);
  if (!target) return null;

  const save = async (ttl: NonNullable<ModelBinding["claudeCacheTtl"]>) => {
    if (disabled || saving.current || ttl === (target.binding.claudeCacheTtl ?? "5m")) return;
    saving.current = true;
    setBusy(true);
    try {
      // Pin the clicked model, but read current bindings before the partial edit.
      const latest = await api.listProviders();
      const current = composerClaudeCacheTarget(latest.providers, providerId, modelId, family);
      if (!current) throw new Error(t("mirrorCoding.model_or_group_unavailable"));
      const saved = await api.updateProvider({
        id: current.provider.id,
        defaultModelId: current.provider.defaultModelId,
        models: current.provider.models.map((binding) => binding.id === current.binding.id
          ? { ...binding, claudeCacheTtl: ttl } : binding),
      });
      if (!saved.provider) throw new Error(t("mirrorCoding.model_or_group_unavailable"));
      await refreshProviders();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return <div className="composer-claude-cache" aria-busy={busy}>
    <span className="composer-claude-cache-label">
      {t("settings.claudeCacheTtl")}
      <HelpIcon label={t("settings.claudeCacheTtlHint")} />
    </span>
    <SegmentedControl
      label={t("settings.claudeCacheTtl")}
      value={target.binding.claudeCacheTtl ?? "5m"}
      options={[
        { value: "5m", label: t("settings.claudeCache5m") },
        { value: "1h", label: t("settings.claudeCache1h") },
      ]}
      disabled={disabled || busy}
      onChange={(ttl) => void save(ttl)}
    />
  </div>;
}
