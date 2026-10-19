import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { MessageQuote } from "@pi-desktop/shared";
import { Button } from "../../components/ui";
import { appendComposerQuotes } from "../../lib/composer-quotes";
import { openSideChat } from "./side-chat-service";
import { selectedQuotes } from "./selected-quotes";
import "./message-quotes.css";

export function SelectionActions({
  rootRef,
  sessionId,
  visible,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  sessionId: string;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    quotes: MessageQuote[];
    x: number;
    y: number;
  } | null>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !selection) return;
    const rect = menu.getBoundingClientRect();
    const x = Math.max(8, Math.min(selection.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(selection.y, window.innerHeight - rect.height - 8));
    if (x !== selection.x || y !== selection.y) setSelection({ ...selection, x, y });
  }, [selection]);
  useEffect(() => {
    if (!visible) {
      setSelection(null);
      return;
    }
    const update = () => {
      if (menuRef.current?.contains(document.activeElement)) return;
      const root = rootRef.current;
      const selected = window.getSelection();
      const quotes = root ? selectedQuotes(root, selected, sessionId) : [];
      if (!quotes.length || !selected) {
        setSelection(null);
        return;
      }
      const rect = selected.getRangeAt(0).getBoundingClientRect();
      setSelection({ quotes, x: Math.max(8, rect.left), y: Math.max(8, rect.bottom + 8) });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      }
      if (
        event.key === "Tab" &&
        window.getSelection()?.toString() &&
        menuRef.current &&
        !menuRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        menuRef.current.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", update);
    rootRef.current?.addEventListener("scroll", update, true);
    const root = rootRef.current;
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", update);
      root?.removeEventListener("scroll", update, true);
    };
  }, [rootRef, sessionId, visible]);
  if (!selection || !visible) return null;
  const choose = (side: boolean) => {
    const quotes = selection.quotes;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (side) void openSideChat(sessionId, quotes);
    else appendComposerQuotes(sessionId, quotes);
  };
  return createPortal(
    <div
      ref={menuRef}
      className="selection-actions"
      role="toolbar"
      aria-label={t("chat.quotes.menu")}
      style={{ left: selection.x, top: selection.y }}
      onPointerDown={(event) => event.preventDefault()}
    >
      <Button variant="ghost" size="sm" onClick={() => choose(false)}>
        {t("chat.quotes.add")}
      </Button>
      {!sessionId.startsWith("remote:") && !sessionId.startsWith("native-pi:") ? (
        <Button variant="ghost" size="sm" onClick={() => choose(true)}>
          {t("chat.quotes.side")}
        </Button>
      ) : null}
    </div>,
    document.body,
  );
}
