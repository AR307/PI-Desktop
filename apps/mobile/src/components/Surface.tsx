import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBackDismiss } from "./useBackDismiss";

/** One modal owner for sheets, full-screen readers and short confirmations. */
export function Surface({ open, title, children, onClose, onBack, variant = "sheet", footer }: {
  open: boolean; title: string; children: ReactNode; onClose(): void;
  onBack?: () => void; variant?: "sheet" | "full" | "confirm"; footer?: ReactNode;
}) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [present, setPresent] = useState(open);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const timer = setTimeout(() => setPresent(false), 180);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!present || !ref.current) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [present]);
  useBackDismiss(open, onBack ?? onClose);
  if (!present) return null;
  return createPortal(<dialog ref={ref} className={`surface surface-${variant} ${open ? "" : "surface-leaving"}`}
    aria-labelledby={id} onCancel={(event) => { event.preventDefault(); (onBack ?? onClose)(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="surface-panel">
      {variant === "sheet" && <div className="surface-handle" aria-hidden="true"/>}
      <header className="surface-header">
        {onBack && <button type="button" className="icon-button" aria-label={t("back")} onClick={onBack}><ArrowLeft size={20}/></button>}
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" aria-label={t("close")} onClick={onClose}><X size={20}/></button>
      </header>
      <div className="surface-body">{children}</div>
      {footer && <footer className="surface-footer">{footer}</footer>}
    </section>
  </dialog>, document.body);
}
