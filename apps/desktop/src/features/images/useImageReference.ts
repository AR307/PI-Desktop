import { useEffect } from "react";
import type { MessageAttachment } from "@pi-desktop/shared";
import type { ComposerDraftController } from "../chat/composer/hooks/useComposerDraft";
import { createFileReference } from "../chat/composer/editor";

const referenceEvent = "pi-use-generated-image";
export function useGeneratedImage(sessionId: string, attachment: MessageAttachment): void {
  window.dispatchEvent(new CustomEvent(referenceEvent, { detail: { sessionId, attachment } }));
}
export function useImageReference(sessionId: string | undefined, draft: ComposerDraftController): void {
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; attachment: MessageAttachment }>).detail;
      if (detail.sessionId !== sessionId) return;
      const attachment = detail.attachment;
      const text = draft.readLiveDraft();
      const references = draft.fileReferencesRef.current;
      if (!references.some((ref) => ref.path === attachment.ref)) {
        draft.applyEditorDraft(text, [...references, createFileReference(attachment.ref, attachment.name, sessionId ?? "", {
          kind: "image", mimeType: attachment.mimeType,
        })], text.length);
      }
      draft.ref.current?.focus();
    };
    window.addEventListener(referenceEvent, receive);
    return () => window.removeEventListener(referenceEvent, receive);
  }, [sessionId, draft]);
}
