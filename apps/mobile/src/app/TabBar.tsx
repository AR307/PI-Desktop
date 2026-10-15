import { useTranslation } from "react-i18next";
import { Bell, MessagesSquare, UserRound } from "lucide-react";

export type Tab = "sessions" | "activity" | "me";

export function TabBar({ tab, onChange, unread }: { tab: Tab; onChange(tab: Tab): void; unread: number }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const items: Array<{ id: Tab; label: string; icon: typeof Bell }> = [
    { id: "sessions", label: t("tabSessions"), icon: MessagesSquare },
    { id: "activity", label: t("tabActivity"), icon: Bell },
    { id: "me", label: t("tabMe"), icon: UserRound },
  ];
  // The unread count describes the Activity tab without changing its name.
  const badged = (id: Tab) => id === "activity" && unread > 0;
  return <nav className="tab-bar" aria-label={t("title")}>
    {items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className="tab-item" aria-current={tab === id ? "page" : undefined} aria-describedby={badged(id) ? "tab-unread" : undefined} onClick={() => onChange(id)}>
      <span className="tab-icon"><Icon size={21} strokeWidth={tab === id ? 2.2 : 1.8}/>
        {badged(id) && <span className="tab-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </span>
      {label}
    </button>)}
    {unread > 0 && <span id="tab-unread" className="visually-hidden">{t("unreadCount", { count: unread })}</span>}
  </nav>;
}
