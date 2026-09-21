import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

export function MirrorCodingDefault() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const providers = useAppStore((state) => state.providers).filter((provider) => provider.mirrorCoding && provider.enabled && provider.hasSecret);
  const models = [...new Set(providers.flatMap((provider) => Object.keys(provider.mirrorCoding?.routes ?? {})))];
  const [modelId, setModelId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!settings || settings.defaultProviderId || !models.length) return null;
  const groups = providers.filter((provider) => !!provider.mirrorCoding?.routes[modelId]);
  const save = async () => {
    if (!groups.some((group) => group.id === providerId)) return;
    setBusy(true); setError(false);
    try {
      const latest = await api.getSettings();
      if (latest.defaultProviderId) { useAppStore.setState({ settings: latest }); return; }
      const next = { ...latest, defaultProviderId: providerId, defaultModelId: modelId };
      await api.setSettings(next);
      useAppStore.setState({ settings: next });
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <section className="settings-card-block mirrorcoding-card">
    <h3>{t("mirrorCoding.chooseDefault")}</h3><p>{t("mirrorCoding.chooseDefaultDescription")}</p>
    <label>{t("mirrorCoding.chooseModel")}<Select value={modelId} onChange={(event) => { setModelId(event.target.value); setProviderId(""); }}><option value="">{t("mirrorCoding.chooseModel")}</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}</Select></label>
    {modelId && <label>{t("mirrorCoding.chooseGroup")}<Select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">{t("mirrorCoding.chooseGroup")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.mirrorCoding?.groupName} · {group.mirrorCoding?.dynamicBilling ? t("mirrorCoding.dynamic") : `${group.mirrorCoding?.ratio}×`}</option>)}</Select></label>}
    <Button disabled={busy || !providerId} onClick={() => void save()}>{t("mirrorCoding.saveDefault")}</Button>
    {error && <p role="alert">{t("mirrorCoding.requestFailed")}</p>}
  </section>;
}
