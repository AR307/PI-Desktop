import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { OverlayBackdrop, TooltipButton, portalOverlay } from "../../components/ui";
import { IconX } from "../../components/icons";
import { useBlockingOverlay } from "../../lib/blocking-overlay";

export function ImportDialog({ title, children, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  useBlockingOverlay();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
      if (event.key !== "Tab") return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return portalOverlay(<OverlayBackdrop className="overlay codex-import-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={ref} tabIndex={-1} className={`dialog codex-import-dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><TooltipButton tooltip={t("common.close")} ariaLabel={t("common.close")} disabled={busy} onClick={onClose}><IconX size={14} /></TooltipButton></header>
      {children}
    </div>
  </OverlayBackdrop>);
}
