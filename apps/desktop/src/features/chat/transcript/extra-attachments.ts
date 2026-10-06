import type { MessageAttachment } from "@pi-desktop/shared";
import { splitChatText } from "../../../lib/chat-links.ts";

/** Attachments already represented by a verified inline file link stay inline. */
export function getExtraMessageAttachments(
  content: string,
  attachments: readonly MessageAttachment[] | undefined,
  workspaceRoot?: string | null,
): (MessageAttachment & { kind: "file" | "image" })[] {
  if (!attachments?.length) return [];
  const inline = new Set(
    splitChatText(content, workspaceRoot)
      .map((segment) => segment.kind === "target" && segment.target.kind === "file"
        ? segment.target.path
        : null)
      .filter((path): path is string => path !== null),
  );
  return attachments.filter(
    (attachment): attachment is MessageAttachment & { kind: "file" | "image" } =>
      attachment.kind !== "session" && !inline.has(attachment.ref),
  );
}
