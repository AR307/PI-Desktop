import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { Button, OverlayBackdrop } from "../../components/ui";
import { useBlockingOverlay } from "../../lib/blocking-overlay";

function CloseDialog({ settle }: { settle: (confirmed: boolean) => void }) {
  useBlockingOverlay();
  const { t } = useTranslation();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <OverlayBackdrop
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <section
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="side-chat-close-title"
        aria-describedby="side-chat-close-detail"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            settle(false);
          }
          if (event.key === "Tab") {
            event.preventDefault();
            (document.activeElement === cancel.current ? confirm : cancel).current?.focus();
          }
        }}
      >
        <h2 id="side-chat-close-title">{t("chat.sideChat.title")}</h2>
        <p id="side-chat-close-detail">{t("chat.sideChat.closeConfirm")}</p>
        <div className="dialog-actions">
          <Button ref={cancel} variant="ghost" onClick={() => settle(false)}>
            {t("common.cancel")}
          </Button>
          <Button ref={confirm} variant="primary" onClick={() => settle(true)}>
            {t("common.close")}
          </Button>
        </div>
      </section>
    </OverlayBackdrop>
  );
}

/** A bounded dialog root, independent of which parent pane is currently visible. */
export function confirmSideChatClose(): Promise<boolean> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      root.unmount();
      container.remove();
      resolve(confirmed);
    };
    root.render(<CloseDialog settle={settle} />);
  });
}
