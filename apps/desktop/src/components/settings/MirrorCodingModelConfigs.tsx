import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MirrorCodingGroupRoute, ModelBinding, ProviderPublic } from "@pi-desktop/shared";
import { Button, Input, cx } from "../ui";
import { IconCheck, IconChevronDown } from "../icons";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

type ModelRow = { modelId: string; provider: ProviderPublic; binding: ModelBinding; groups: MirrorCodingGroupRoute[] };

function modelRows(providers: ProviderPublic[]): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const provider of providers) {
    if (provider.authKind !== "mirrorcoding" || provider.mirrorCoding?.scope !== "account") continue;
    for (const binding of provider.models) {
      const groups = (provider.mirrorCoding.groups ?? []).filter((group) =>
        Boolean(group.routes[binding.id] || group.imageRoutes?.[binding.id] || group.imageModels?.[binding.id]),
      );
      rows.push({ modelId: binding.id, provider, binding, groups });
    }
  }
  return rows
    .sort((left, right) => left.modelId.localeCompare(right.modelId));
}

function rate(group: MirrorCodingGroupRoute, dynamic: string): string {
  return group.dynamicBilling || group.ratio == null
    ? dynamic
    : String(group.ratio) + "×";
}

export function MirrorCodingModelConfigs({ providers }: { providers: ProviderPublic[] }) {
  const { t } = useTranslation();
  const refreshProviders = useAppStore((state) => state.refreshProviders);
  const showToast = useAppStore((state) => state.showToast);
  const rows = useMemo(() => modelRows(providers), [providers]);
  const [expanded, setExpanded] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, ModelBinding>>({});
  const [saving, setSaving] = useState<string>();

  if (rows.length === 0) {
    return (
      <section className="settings-card-block mirrorcoding-model-configs">
        <div className="model-config-section-head">
          <div>
            <h3 className="settings-card-heading">{t("settings.modelConfigurations")}</h3>
            <p className="settings-row-detail">{t("mirrorCoding.description")}</p>
          </div>
          <span className="provider-section-count">0</span>
        </div>
        <div className="settings-panel mirrorcoding-model-config-panel mirrorcoding-model-config-empty" role="status">
          {t("mirrorCoding.empty")}
        </div>
      </section>
    );
  }

  const draftFor = (entry: ModelRow): ModelBinding => {
    const key = entry.provider.id + ":" + entry.binding.id;
    return drafts[key] ?? entry.binding;
  };
  const updateDraft = (entry: ModelRow, patch: Partial<ModelBinding>) => {
    const key = entry.provider.id + ":" + entry.binding.id;
    setDrafts((current) => ({ ...current, [key]: { ...draftFor(entry), ...patch } }));
  };
  const save = async (entry: ModelRow) => {
    const key = entry.provider.id + ":" + entry.binding.id;
    const next = draftFor(entry);
    setSaving(key);
    try {
      const models = entry.provider.models.map((binding) =>
        binding.id === entry.binding.id ? next : binding,
      );
      await api.updateProvider({ id: entry.provider.id, models });
      await refreshProviders();
      setDrafts((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
      showToast(t("settings.providerSaved"), { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <section className="settings-card-block mirrorcoding-model-configs">
      <div className="model-config-section-head">
        <div>
          <h3 className="settings-card-heading">{t("settings.modelConfigurations")}</h3>
          <p className="settings-row-detail">{t("mirrorCoding.description")}</p>
        </div>
        <span className="provider-section-count">{rows.length}</span>
      </div>
      <div className="settings-panel mirrorcoding-model-config-panel">
        <ul className="mirrorcoding-model-list">
          {rows.map((row) => {
            const isOpen = expanded === row.modelId;
            return (
              <li className="mirrorcoding-model-row" key={row.modelId}>
                <button
                  type="button"
                  className="mirrorcoding-model-row-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? undefined : row.modelId)}
                >
                  <span className="mirrorcoding-model-id font-mono">{row.modelId}</span>
                  <span className="mirrorcoding-model-group-count">
                    {t("mirrorCoding.models", { count: row.groups.length })}
                  </span>
                  <IconChevronDown size={14} className={cx("mirrorcoding-model-chevron", isOpen && "is-open")} />
                </button>
                {isOpen ? (
                  <div className="mirrorcoding-model-groups">
                    {(() => {
                      const draft = draftFor(row);
                      const key = row.provider.id + ":" + row.binding.id;
                      return (
                        <div className="mirrorcoding-model-group-config" key={row.provider.id}>
                          <div className="mirrorcoding-model-group-head">
                            <div>
                              <strong>{row.provider.name}</strong>
                              <p>{t("mirrorCoding.models", { count: row.groups.length })}</p>
                            </div>
                            <span>{t("mirrorCoding.chooseGroup")}</span>
                          </div>
                          <div className="mirrorcoding-model-group-choices" role="group" aria-label={t("mirrorCoding.chooseGroup")}>
                            {row.groups.map((group) => {
                              const selected = draft.mirrorCodingGroupId === group.id;
                              return (
                                <button
                                  type="button"
                                  key={group.id}
                                  className={cx("mirrorcoding-group-choice", selected && "selected")}
                                  aria-pressed={selected}
                                  onClick={() => updateDraft(row, { mirrorCodingGroupId: group.id })}
                                >
                                  <span><strong>{group.name}</strong><small>{group.description}</small></span>
                                  <span>{rate(group, t("mirrorCoding.dynamic"))}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="mirrorcoding-model-fields">
                            <label>
                              <span>{t("settings.contextWindow")}</span>
                              <Input
                                type="number"
                                min={1}
                                value={draft.contextWindow}
                                onChange={(event) => updateDraft(row, {
                                  contextWindow: Number(event.target.value) || 0,
                                  contextWindowSource: "user",
                                })}
                              />
                            </label>
                            <label>
                              <span>{t("settings.maxOutput")}</span>
                              <Input
                                type="number"
                                min={1}
                                value={draft.maxTokens}
                                onChange={(event) => updateDraft(row, {
                                  maxTokens: Number(event.target.value) || 0,
                                })}
                              />
                            </label>
                            <label>
                              <span>{t("chat.reasoningLevel")}</span>
                              <select
                                value={draft.defaultThinkingLevel ?? "off"}
                                onChange={(event) => updateDraft(row, {
                                  defaultThinkingLevel: event.target.value as ModelBinding["defaultThinkingLevel"],
                                })}
                              >
                                {draft.thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                              </select>
                            </label>
                            <label>
                              <span>{t("settings.temperature")}</span>
                              <Input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={draft.temperature ?? ""}
                                onChange={(event) => updateDraft(row, {
                                  temperature: event.target.value === "" ? undefined : Number(event.target.value),
                                })}
                              />
                            </label>
                          </div>
                          <Button
                            variant="ghost"
                            disabled={saving === key}
                            onClick={() => void save(row)}
                          >
                            <IconCheck size={13} />
                            {t("common.save")}
                          </Button>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
