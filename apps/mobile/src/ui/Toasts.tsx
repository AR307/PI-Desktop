import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Hold a toast long enough to read, then let it leave with its exit animation. */
function useAutoDismiss(active: boolean, delay: number | undefined, dismiss: () => void) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!active || delay === undefined) return;
    const timer = setTimeout(() => latest.current(), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
}

/**
 * A floating toast that can be tapped, closed or flicked upwards. Errors stay
 * until dismissed; informational toasts leave on their own.
 */
export function Toast({ icon, title, body, tone = "info", autoDismissMs, onPress, onDismiss, role = "status" }: {
  icon?: ReactNode; title: ReactNode; body?: ReactNode; tone?: "info" | "error"; autoDismissMs?: number;
  onPress?: () => void; onDismiss(): void; role?: "status" | "alert";
}) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ pointer: number; y: number } | null>(null);
  const leave = () => { if (!leaving) { setLeaving(true); setTimeout(onDismiss, 180); } };
  useAutoDismiss(!leaving, autoDismissMs, leave);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => { drag.current = { pointer: event.pointerId, y: event.clientY }; };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current; drag.current = null;
    if (start && start.pointer === event.pointerId && start.y - event.clientY > 28) leave();
  };
  return <div className={`toast ${tone === "error" ? "error" : ""} ${leaving ? "leaving" : ""}`} role={role} onPointerDown={down} onPointerUp={up}>
    {icon}
    {onPress
      ? <button type="button" className="toast-body toast-press" onClick={() => { onPress(); leave(); }}><strong>{title}</strong>{body && <span>{body}</span>}</button>
      : <span className="toast-body"><strong>{title}</strong>{body && <span>{body}</span>}</span>}
    <button type="button" className="icon-button" aria-label={t("close")} onClick={leave}><X size={16}/></button>
  </div>;
}
