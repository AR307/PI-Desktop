import type { MessageQuote } from "@pi-desktop/shared";
import type { ComposerDraftSnapshot } from "./composer-smart-stop";
import {
  markComposerDraftEdited,
  readComposerDraft,
  writeComposerDraft,
} from "./composer-draft-cache";

type Receiver = (quotes: readonly MessageQuote[]) => void;
const receivers = new Map<string, Receiver>();
const readers = new Map<string, () => ComposerDraftSnapshot>();

export function focusSessionComposer(sessionId: string): void {
  document
    .querySelector<HTMLElement>(
      `[data-composer-session="${CSS.escape(sessionId)}"] .composer-input`,
    )
    ?.focus();
}

export function registerComposerDraftReader(
  sessionId: string,
  read: () => ComposerDraftSnapshot,
): () => void {
  readers.set(sessionId, read);
  return () => {
    if (readers.get(sessionId) === read) readers.delete(sessionId);
  };
}

export function readLiveComposerDraft(sessionId: string): ComposerDraftSnapshot | undefined {
  return readers.get(sessionId)?.() ?? readComposerDraft(sessionId);
}

/** Deliver to the live editor without replacing its unsaved text or files. */
export function registerComposerQuotes(sessionId: string, receive: Receiver): () => void {
  receivers.set(sessionId, receive);
  return () => {
    if (receivers.get(sessionId) === receive) receivers.delete(sessionId);
  };
}

export function appendComposerQuotes(sessionId: string, quotes: readonly MessageQuote[]): void {
  const receive = receivers.get(sessionId);
  if (receive) {
    receive(quotes);
    return;
  }
  const draft = readComposerDraft(sessionId) ?? { text: "", fileReferences: [] };
  writeComposerDraft(sessionId, { ...draft, quotes: [...(draft.quotes ?? []), ...quotes] });
  markComposerDraftEdited(sessionId);
}
