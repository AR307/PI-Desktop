import { useTranslation } from "react-i18next";
import { BatteryWarning, Bell, BellOff, BellRing, CircleAlert, CircleCheck, MessageCircleQuestion, Settings2 } from "lucide-react";
import type { MobileController, MobileView } from "../../state/controller";
import type { KeepAliveMode } from "../../state/keep-alive";
import { Row, Section, Segmented, Switch } from "../../ui/controls";

/** Notification categories, OS permission and the background connection policy. */
export function NotificationSettings({ controller, view, native }: { controller: MobileController; view: MobileView; native: boolean }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const { preferences, permission, keepAliveMode, batteryRestricted } = view.notifications;
  const set = (patch: Partial<typeof preferences>) => controller.setNotificationPreferences({ ...preferences, ...patch });
  const blocked = permission === "denied";
  const prompt = permission === "prompt";
  const hint = keepAliveMode === "auto" ? "keepAliveAutoHint" : keepAliveMode === "always" ? "keepAliveAlwaysHint" : "keepAliveOffHint";
  return <>
    <Section title={t("notifications")}>
      <Row leading={<Bell size={18}/>} title={t("allowNotifications")} trailing={<Switch checked={preferences.enabled} label={t("allowNotifications")} onChange={(enabled) => set({ enabled })}/>}/>
      {preferences.enabled && prompt && <Row leading={<BellRing size={18}/>} title={t("enableNotificationsTitle")} subtitle={t("enableNotificationsHint")} chevron onClick={() => void controller.requestNotificationPermission()}/>}
      {preferences.enabled && blocked && <Row leading={<BellOff size={18}/>} title={t("openSettings")} subtitle={t("notificationsBlocked")} chevron onClick={() => void controller.openSystemSettings("notifications")}/>}
      <Row leading={<MessageCircleQuestion size={18}/>} title={t("notifyNeedsAction")} trailing={<Switch checked={preferences.needsAction} disabled={!preferences.enabled} label={t("notifyNeedsAction")} onChange={(needsAction) => set({ needsAction })}/>}/>
      <Row leading={<CircleCheck size={18}/>} title={t("notifyCompleted")} trailing={<Switch checked={preferences.completed} disabled={!preferences.enabled} label={t("notifyCompleted")} onChange={(completed) => set({ completed })}/>}/>
      <Row leading={<CircleAlert size={18}/>} title={t("notifyFailed")} trailing={<Switch checked={preferences.failed} disabled={!preferences.enabled} label={t("notifyFailed")} onChange={(failed) => set({ failed })}/>}/>
    </Section>
    {native && <Section title={t("backgroundConnection")}>
      <div className="setting-block">
        <Segmented<KeepAliveMode> label={t("backgroundConnection")} value={keepAliveMode} onChange={(mode) => controller.setKeepAliveMode(mode)}
          options={[{ value: "auto", label: t("keepAliveAuto") }, { value: "always", label: t("keepAliveAlways") }, { value: "off", label: t("keepAliveOff") }]}/>
        <p>{t(hint)}</p>
      </div>
      {keepAliveMode !== "off" && batteryRestricted && <Row leading={<BatteryWarning size={18}/>} title={t("batterySettings")} subtitle={t("batteryRestricted")} chevron onClick={() => void controller.openSystemSettings("battery")}/>}
      {keepAliveMode !== "off" && <Row leading={<Settings2 size={18}/>} title={t("appSettings")} subtitle={t("backgroundGuide")} chevron onClick={() => void controller.openSystemSettings("app")}/>}
    </Section>}
  </>;
}
