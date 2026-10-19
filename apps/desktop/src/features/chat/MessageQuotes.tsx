import type { MessageQuote } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";
import { IconChevronRight, IconClose } from "../../components/icons";
import { Tooltip, TooltipButton } from "../../components/ui";
import "./message-quotes.css";

export function MessageQuotes({
  quotes,
  onRemove,
}: {
  quotes?: readonly MessageQuote[];
  onRemove?: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (!quotes?.length) return null;
  return (
    <details className="message-quotes" data-message-quotes>
      <summary>
        <IconChevronRight className="message-quotes-chevron" size={12} aria-hidden="true" />
        {t("chat.quotes.count", { count: quotes.length })}
      </summary>
      {quotes.map((quote, index) => (
        <div className="message-quote" key={`${quote.messageId}:${index}`}>
          <div className="message-quote-heading">
            <Tooltip
              className="message-quote-source"
              label={t("chat.quotes.source", { session: quote.sessionId, message: quote.messageId })}
            >
              {t("chat.quotes.reference", { index: index + 1 })}
            </Tooltip>
            {onRemove ? (
              <TooltipButton
                type="button"
                className="icon-btn message-quote-remove"
                onClick={() => onRemove(index)}
                tooltip={t("chat.quotes.remove", { index: index + 1 })}
              >
                <IconClose size={13} aria-hidden="true" />
              </TooltipButton>
            ) : null}
          </div>
          <blockquote>{quote.text}</blockquote>
        </div>
      ))}
    </details>
  );
}
