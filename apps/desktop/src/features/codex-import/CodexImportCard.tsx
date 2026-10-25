import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Button, Panel, SettingsToggle, TooltipButton } from "../../components/ui";
import { IconX } from "../../components/icons";
import { useCodexImport } from "./store";
import { ImportDialog } from "./ImportDialog";
import "./codex-import.css";

export function CodexImportCard() {
  const { t } = useTranslation();
  const state = useCodexImport();
  useEffect(() => { void useCodexImport.getState().initialize(); }, []);
  if (!state.ready || !state.enabled || state.hiddenThisRun) return null;
  return <div className="codex-import-pinned no-drag" data-testid="codex-import-card"><Panel className="codex-import-card">
    <div className="codex-import-card-head"><strong>{t("codexImport.title")}</strong>
      <TooltipButton tooltip={t("common.close")} ariaLabel={t("codexImport.dismissTitle")} onClick={() => useCodexImport.setState({ dismissOpen: true })}><IconX size={12} /></TooltipButton>
    </div>
    <p>{t("codexImport.description")}</p>
    <Button variant="secondary" onClick={state.show}>{t("codexImport.action")}</Button>
  </Panel></div>;
}
export function CodexImportSettings() {
  const { t } = useTranslation(); const state = useCodexImport();
  return <div className="codex-import-settings">
    <Button variant="secondary" onClick={state.show}>{t("codexImport.settingsAction")}</Button>
    <label>{t("codexImport.showHint")}<SettingsToggle label={t("codexImport.showHint")} checked={state.enabled && !state.hiddenThisRun} onChange={() => state.setEnabled(!state.enabled || state.hiddenThisRun)} /></label>
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}
export function CodexImportDismissDialog() {
  const { t } = useTranslation(); const state = useCodexImport();
  if (!state.dismissOpen) return null;
  return <ImportDialog title={t("codexImport.dismissTitle")} onClose={() => useCodexImport.setState({ dismissOpen: false })}>
    <p>{t("codexImport.dismissDescription")}</p>
    {state.error && <p role="alert">{state.error}</p>}
    <footer><Button variant="ghost" onClick={() => useCodexImport.setState({ dismissOpen: false })}>{t("common.cancel")}</Button>
      <Button variant="secondary" onClick={() => state.dismiss(false)}>{t("codexImport.dismissOnce")}</Button>
      <Button variant="primary" onClick={() => state.dismiss(true)}>{t("codexImport.dismissForever")}</Button></footer>
  </ImportDialog>;
}
