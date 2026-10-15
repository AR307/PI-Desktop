import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBackDismiss } from "./useBackDismiss";

/** Drag distance or downward speed (px/ms) that dismisses a bottom sheet. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.55;

/**
 * One modal owner for bottom sheets, full-screen readers and short
 * confirmations. Sheets follow the finger from their handle or header and
 * close on a decisive downward drag; Android Back closes the innermost one.
 */
export function Surface({ open, title, children, onClose, onBack, variant = "sheet", footer }: {
  open: boolean; title: string; children: ReactNode; onClose(): void;
  onBack?: () => void; variant?: "sheet" | "full" | "confirm"; footer?: ReactNode;
}) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointer: number; startY: number; lastY: number; lastTime: number } | null>(null);
  const [present, setPresent] = useState(open);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const timer = setTimeout(() => setPresent(false), 200);
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
  useEffect(() => { if (open) panel.current?.style.removeProperty("--sheet-drag"); }, [open]);
  useBackDismiss(open, onBack ?? onClose);
  if (!present) return null;

  const draggable = variant === "sheet";
  const start = (event: ReactPointerEvent<HTMLElement>) => {
    if (!draggable || (event.target as HTMLElement).closest("button, input, select, textarea, a")) return;
    drag.current = { pointer: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp };
    event.currentTarget.setPointerCapture(event.pointerId);
    panel.current?.classList.add("dragging");
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - state.startY);
    panel.current?.style.setProperty("--sheet-drag", `${offset}px`);
    state.lastY = event.clientY; state.lastTime = event.timeStamp;
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    drag.current = null;
    panel.current?.classList.remove("dragging");
    const offset = event.clientY - state.startY;
    const velocity = (event.clientY - state.lastY) / Math.max(1, event.timeStamp - state.lastTime);
    if (offset > DISMISS_DISTANCE || (offset > 24 && velocity > DISMISS_VELOCITY)) onClose();
    else panel.current?.style.setProperty("--sheet-drag", "0px");
  };
  const dragHandlers = draggable ? { onPointerDown: start, onPointerMove: move, onPointerUp: end, onPointerCancel: end } : {};

  return createPortal(<dialog ref={ref} className={`surface surface-${variant} ${open ? "" : "surface-leaving"}`}
    aria-labelledby={id} onCancel={(event) => { event.preventDefault(); (onBack ?? onClose)(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="surface-panel">
      {draggable && <div className="surface-handle" aria-hidden="true" {...dragHandlers}/>}
      <header className="surface-header" {...dragHandlers}>
        {onBack && <button type="button" className="icon-button" aria-label={t("back")} onClick={onBack}><ArrowLeft size={20}/></button>}
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" aria-label={t("close")} onClick={onClose}><X size={20}/></button>
      </header>
      <div className="surface-body">{children}</div>
      {footer && <footer className="surface-footer">{footer}</footer>}
    </section>
  </dialog>, document.body);
}
