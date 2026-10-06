import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Button, Field, PasswordInput, SettingsToggle } from "../ui";
import { SettingsCard, SettingsRow } from "../../features/settings/primitives";

type KeyStatus = "loading" | "configured" | "missing" | "unavailable";
type BusyAction = "save" | "remove" | "toggle" | null;

async function persistSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = useAppStore.getState().settings;
  if (!current) throw new Error("Settings are not ready");
  const next = { ...current, ...patch };
  await api.setSettings(next);
  useAppStore.setState({ settings: next });
}

export function JevSettingsCard({ settings }: { settings?: AppSettings }) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("loading");
  const [busy, setBusy] = useState<BusyAction>(null);
  const enabled = settings?.jevEnabled === true;
  const configured = keyStatus === "configured";

  useEffect(() => {
    let current = true;
    void api.hasJevApiKey().then(
      (hasKey) => {
        if (current) setKeyStatus(hasKey ? "configured" : "missing");
      },
      () => {
        if (current) setKeyStatus("unavailable");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setBusy("save");
    try {
      await api.setJevApiKey(keyDraft);
      setKeyDraft("");
      setKeyStatus("configured");
      showToast(t("settings.jevKeySaved"), { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async () => {
    setBusy("remove");
    try {
      if (enabled) await persistSettings({ jevEnabled: false });
      await api.deleteJevApiKey();
      setKeyStatus("missing");
      setKeyDraft("");
      showToast(t("settings.jevKeyRemoved"), { variant: "success" });
    } catch (error) {
      try {
        setKeyStatus((await api.hasJevApiKey()) ? "configured" : "missing");
      } catch {
        setKeyStatus("unavailable");
      }
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async () => {
    if (!settings || (!enabled && !configured)) return;
    setBusy("toggle");
    try {
      await persistSettings({ jevEnabled: !enabled });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const keyStatusText =
    keyStatus === "configured"
      ? t("settings.jevKeyConfigured")
      : keyStatus === "unavailable"
        ? t("settings.jevKeyStatusUnavailable")
        : keyStatus === "loading"
          ? t("settings.jevKeyStatusChecking")
          : t("settings.jevKeyMissing");

  return (
    <SettingsCard
      title={t("settings.jevTitle")}
      description={t("settings.jevDescription")}
    >
      <SettingsRow
        title={t("settings.jevEnable")}
        description={t("settings.jevEnableDescription")}
        detail={keyStatusText}
      >
        <SettingsToggle
          checked={enabled}
          label={t("settings.jevEnable")}
          disabled={busy !== null || !settings || (!configured && !enabled)}
          busy={busy === "toggle"}
          onChange={() => void toggleEnabled()}
        />
      </SettingsRow>
      <p className="jev-settings-privacy-note">{t("settings.jevPrivacyNotice")}</p>
      <div className="jev-settings-key-form">
        <Field label={t("settings.jevApiKey")}>
          <PasswordInput
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder={t("settings.jevApiKeyPlaceholder")}
            aria-label={t("settings.jevApiKey")}
            autoComplete="new-password"
            showLabel={t("settings.showPassword")}
            hideLabel={t("settings.hidePassword")}
            disabled={busy !== null}
          />
        </Field>
        <div className="jev-settings-key-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={busy !== null || !keyDraft.trim()}
            onClick={() => void saveKey()}
          >
            {t("settings.jevSaveKey")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              busy !== null || keyStatus === "missing" || keyStatus === "loading"
            }
            onClick={() => void removeKey()}
          >
            {t("settings.jevRemoveKey")}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}
