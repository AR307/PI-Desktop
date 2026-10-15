import { useTranslation } from "react-i18next";
import { BatteryWarning } from "lucide-react";
import type { MobileController, MobileView } from "../../state/controller";
import { backgroundNotice, type BackgroundVendor } from "../../state/background-delivery";

/** Where each vendor keeps the switch that lets an app run in the background. */
export const BACKGROUND_STEPS: Record<BackgroundVendor, string> = {
  oppo: "backgroundStepsOppo", vivo: "backgroundStepsVivo", xiaomi: "backgroundStepsXiaomi",
  huawei: "backgroundStepsHuawei", samsung: "backgroundStepsSamsung", other: "backgroundStepsOther",
};

/**
 * Tells the user that the system holds PI Mobile back in the background, or
 * will on this vendor, with the switch to change and a way to reach it.
 * `delayed` appears once deliveries were actually late; `setup` appears up front.
 */
export function BackgroundDeliveryNotice({ controller, view, variants }: { controller: MobileController; view: MobileView; variants: ReadonlyArray<"delayed" | "setup"> }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const settings = view.notifications;
  if (settings.permission === "unsupported") return null;
  const notice = backgroundNotice({
    vendor: settings.vendor, notificationsEnabled: settings.preferences.enabled, permission: settings.permission, keepAliveOff: settings.keepAliveMode === "off",
    ...(settings.backgroundDelayedAt ? { delayedAt: settings.backgroundDelayedAt } : {}),
    ...(settings.backgroundNoticeDismissedAt ? { dismissedAt: settings.backgroundNoticeDismissedAt } : {}),
  });
  if (!notice || !variants.includes(notice)) return null;
  return <div className="banner warning background-notice" role="status">
    <BatteryWarning size={18} className="banner-icon"/>
    <span className="banner-body">
      <strong>{t(notice === "delayed" ? "backgroundDelayedTitle" : "backgroundSetupTitle")}</strong>
      <span>{t(notice === "delayed" ? "backgroundDelayedBody" : "backgroundSetupBody")}</span>
      <span>{t(BACKGROUND_STEPS[settings.vendor])}</span>
      <span className="banner-actions">
        {settings.batteryRestricted && <button type="button" className="button-primary" onClick={() => void controller.requestBackgroundExemption()}>{t("allowBackground")}</button>}
        <button type="button" className={settings.batteryRestricted ? undefined : "button-primary"} onClick={() => void controller.openSystemSettings("app")}>{t("openAppSettings")}</button>
        <button type="button" onClick={() => controller.dismissBackgroundNotice()}>{t("backgroundDone")}</button>
      </span>
    </span>
  </div>;
}
