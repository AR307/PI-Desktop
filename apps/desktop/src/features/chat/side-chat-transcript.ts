import type { UiMessage } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import type { SessionRuntime } from "../../stores/runtime/session-runtime";
import type { StoreAccess } from "../../stores/slices/types";

/** Edit the child's own turns without discarding its memory-only parent context. */
export function sideChatTranscriptActions(
  { get, set }: StoreAccess,
  runtime: Pick<SessionRuntime, "loadFullSessionMessages" | "cacheSessionTranscript">,
) {
  const editing = new Set<string>();
  const available = (id: string) => {
    const state = get();
    return (
      state.sessions.some((session) => session.id === id) &&
      !state.runningSessions[id] &&
      state.pendingPlans[id]?.status !== "pending"
    );
  };
  const report = (error: unknown) =>
    get().showToast(error instanceof Error ? error.message : String(error), { variant: "error" });

  async function prepare(id: string, messageId: string, signal?: AbortSignal) {
    if (!available(id) || signal?.aborted) return null;
    try {
      const messages = await runtime.loadFullSessionMessages(id, false);
      if (!available(id) || signal?.aborted) return null;
      const message = messages?.find((entry) => entry.id === messageId);
      return message?.role === "user" && !message.sessionMessage ? message : null;
    } catch (error) {
      if (!signal?.aborted) report(error);
      return null;
    }
  }

  async function edit(
    id: string,
    messageId: string,
    content: string,
    attachments?: UiMessage["attachments"],
  ) {
    if (!available(id) || editing.has(id)) return false;
    editing.add(id);
    try {
      const messages = await runtime.loadFullSessionMessages(id, false);
      if (!messages || !available(id)) return false;
      const index = messages.findIndex((message) => message.id === messageId);
      const source = messages[index];
      if (!source || source.role !== "user" || source.sessionMessage) return false;
      const files = attachments ?? source.attachments ?? [];
      if (!content.trim() && !files.length && !source.quotes?.length) return false;
      const kept = messages.slice(0, index);
      await api.replaceSessionMessages(id, kept);
      if (!available(id)) return false;
      runtime.cacheSessionTranscript(id, kept, { messageStart: 0, hasMoreBefore: false });
      set((state) => ({ retainedTranscripts: { ...state.retainedTranscripts, [id]: kept } }));
      return await get().sendPrompt(
        content,
        {
          text: content,
          quotes: source.quotes,
          fileReferences: files.map((file) => ({
            path: file.ref,
            name: file.name,
            kind: file.kind,
            mimeType: file.mimeType,
          })),
        },
        id,
      );
    } catch (error) {
      report(error);
      return false;
    } finally {
      editing.delete(id);
    }
  }

  async function retry(id: string, messageId: string) {
    if (!available(id)) return;
    try {
      const messages = await runtime.loadFullSessionMessages(id, false);
      if (!messages || !available(id)) return;
      const index = messages.findIndex(
        (message) => message.id === messageId && message.role === "assistant",
      );
      const source = messages
        .slice(0, Math.max(0, index))
        .findLast((message) => message.role === "user" && !message.sessionMessage);
      if (source) await edit(id, source.id, source.command || source.content, source.attachments);
    } catch (error) {
      report(error);
    }
  }

  return { prepare, edit, retry };
}
