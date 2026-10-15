import { useTranslation } from "react-i18next";
import { AlertTriangle, Bell, BellOff, CheckCheck, CheckCircle2, ClipboardCheck, Image as ImageIcon, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import type { MobileController, MobileView } from "../state/controller";
import { attentionCategory, type AttentionItem } from "../state/attention";
import { dayBucket, relativeTime } from "../state/labels";
import { formatAttention } from "../services/attention-text";
import { useAttention } from "../features/notifications/useAttention";
import { Screen } from "../ui/Screen";
import { EmptyState } from "../ui/controls";

function ActivityIcon({ item }: { item: AttentionItem }) {
  const Icon = item.kind === "input" ? MessageCircleQuestion
    : item.kind === "approval" ? item.requestKind && item.requestKind !== "tool" ? ClipboardCheck : ShieldAlert
    : item.image ? ImageIcon : item.kind === "completed" ? CheckCircle2 : AlertTriangle;
  return <span className={`activity-icon ${attentionCategory(item.kind)}`}><Icon size={18}/></span>;
}

/** Ask for notification permission in context, never on first launch. */
export function NotificationPermissionBanner({ controller, view }: { controller: MobileController; view: MobileView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const { permission, preferences } = view.notifications;
  if (!preferences.enabled || (permission !== "prompt" && permission !== "denied")) return null;
  const denied = permission === "denied";
  return <div className="banner" role="status">
    {denied ? <BellOff size={18} className="banner-icon"/> : <Bell size={18} className="banner-icon"/>}
    <span className="banner-body">
      <strong>{t(denied ? "notificationsBlocked" : "enableNotificationsTitle")}</strong>
      {!denied && <span>{t("enableNotificationsHint")}</span>}
      <span className="banner-actions">
        <button type="button" className="button-primary" onClick={() => void (denied ? controller.openSystemSettings("notifications") : controller.requestNotificationPermission())}>{t(denied ? "openSettings" : "enableNotifications")}</button>
      </span>
    </span>
  </div>;
}

export function ActivityScreen({ controller, view, onOpen }: { controller: MobileController; view: MobileView; onOpen(desktopId: string, sessionId: string): void }) {
  const { t, i18n } = useTranslation("translation", { keyPrefix: "mobile" });
  const { t: translate } = useTranslation();
  const { items, unread, center } = useAttention(controller);
  const buckets = (["today", "yesterday", "earlier"] as const).map((bucket) => ({ bucket, rows: items.filter((item) => dayBucket(item.receivedAt) === bucket) })).filter(({ rows }) => rows.length);
  return <Screen title={t("activityTitle")} actions={unread > 0 ? <button type="button" className="icon-button" aria-label={t("markAllRead")} onClick={() => void center.markAllRead()}><CheckCheck size={20}/></button> : undefined}>
    <NotificationPermissionBanner controller={controller} view={view}/>
    {items.length === 0
      ? <EmptyState icon={<Bell size={28}/>} title={t("activityEmpty")}>{t("activityEmptyHint")}</EmptyState>
      : buckets.map(({ bucket, rows }) => <section key={bucket} className="section">
        <div className="section-header"><span>{t(bucket)}</span></div>
        <div className="session-list">
          {rows.map((item) => {
            const text = formatAttention(item, translate);
            return <button type="button" key={item.key} className={`activity-row ${item.read ? "read" : ""} ${item.resolved ? "resolved" : ""}`} onClick={() => onOpen(item.desktopDeviceId, item.sessionId)}>
              <ActivityIcon item={item}/>
              <span className="activity-main">
                <span className="activity-title"><strong>{text.title}</strong></span>
                {text.body && <span className="activity-detail">{text.body}</span>}
                <span className="activity-meta">{[item.desktopName, relativeTime(item.receivedAt, i18n.language), item.resolved ? t("handled") : undefined].filter(Boolean).join(" · ")}</span>
              </span>
              {!item.read && <span className="unread-dot" role="img" aria-label={t("unread")}/>}
            </button>;
          })}
        </div>
      </section>)}
  </Screen>;
}
