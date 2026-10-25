import type { MessageQuote } from "@pi-desktop/shared";
import { expandRangeToWholeKatex, KATEX_TEX_SELECTOR } from "../../lib/selection-tex";

const EXCLUDED =
  "button,input,textarea,[contenteditable],[hidden],[aria-hidden=true],.code-block-header,[data-message-quotes]";

function selectedText(node: Node, range: Range): string {
  if (!range.intersectsNode(node)) return "";
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    return value.slice(
      node === range.startContainer ? range.startOffset : 0,
      node === range.endContainer ? range.endOffset : value.length,
    );
  }
  if (!(node instanceof HTMLElement)) return "";
  if (node.matches(EXCLUDED)) return "";
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")
    return "";
  if (node.matches(".katex")) {
    const tex = node.querySelector(KATEX_TEX_SELECTOR)?.textContent;
    if (tex) return `$${tex}$`;
  }
  if (node.tagName === "BR") return "\n";
  const text = [...node.childNodes].map((child) => selectedText(child, range)).join("");
  return /^(P|PRE|LI|TR|H[1-6]|BLOCKQUOTE)$/.test(node.tagName) ? text + "\n" : text;
}

/** Read only explicitly marked human/assistant bodies, never tool chrome. */
export function selectedQuotes(
  root: HTMLElement,
  selection: Selection | null,
  sessionId: string,
): MessageQuote[] {
  if (!selection?.rangeCount || selection.isCollapsed) return [];
  const live = selection.getRangeAt(0);
  if (!root.contains(live.startContainer) || !root.contains(live.endContainer)) return [];
  const quotes: MessageQuote[] = [];
  for (const body of root.querySelectorAll<HTMLElement>("[data-quote-body]")) {
    if (!live.intersectsNode(body) || !body.getClientRects().length) continue;
    const range = document.createRange();
    range.selectNodeContents(body);
    if (live.compareBoundaryPoints(Range.START_TO_START, range) > 0)
      range.setStart(live.startContainer, live.startOffset);
    if (live.compareBoundaryPoints(Range.END_TO_END, range) < 0)
      range.setEnd(live.endContainer, live.endOffset);
    const text = selectedText(body, expandRangeToWholeKatex(range)).trim();
    if (!text) continue;
    const previous = quotes.find((quote) => quote.messageId === body.dataset.quoteBody);
    if (previous) previous.text += "\n\n" + text;
    else quotes.push({ sessionId, messageId: body.dataset.quoteBody!, text });
  }
  return quotes;
}
