import type { MessageQuote, SessionSummary } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { appendComposerQuotes, readLiveComposerDraft } from "../../lib/composer-quotes";
import { confirmSideChatClose } from "./confirm-side-chat-close";
import { deleteComposerDraft } from "../../lib/composer-draft-cache";
import { useAppStore } from "../../stores/app-store";

const opening = new Map<string, Promise<SessionSummary>>();

export async function openSideChat(
  parentId: string,
  quotes: readonly MessageQuote[],
): Promise<void> {
  try {
    let request = opening.get(parentId);
    if (!request) {
      request = api.openSideChat(parentId).then(({ session }) => {
        useAppStore.setState((state) => ({
          sessions: [...state.sessions.filter((item) => item.id !== session.id), session],
          retainedTranscripts: {
            ...state.retainedTranscripts,
            [session.id]: state.retainedTranscripts[session.id] ?? [],
          },
        }));
        return session;
      });
      opening.set(parentId, request);
      void request.finally(() => opening.delete(parentId)).catch(() => undefined);
    }
    const session = await request;
    appendComposerQuotes(session.id, quotes);
    const state = useAppStore.getState();
    const tab = { id: `side-chat:${session.id}`, kind: "side-chat" as const, resource: session.id };
    if (state.activeSessionId === parentId) state.openWorkPanelTab(tab);
    else
      useAppStore.setState((current) => {
        const context = current.workPanelContexts[parentId] ?? {
          open: false,
          tabs: [],
          activeTabId: null,
          fileRequest: null,
        };
        return {
          workPanelContexts: {
            ...current.workPanelContexts,
            [parentId]: {
              ...context,
              open: true,
              tabs: [...context.tabs.filter((item) => item.id !== tab.id), tab],
              activeTabId: tab.id,
            },
          },
        };
      });
  } catch (error) {
    useAppStore
      .getState()
      .showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  }
}

export async function closeSideChat(sessionId: string): Promise<void> {
  await api.closeSideChat(sessionId);
  deleteComposerDraft(sessionId);
  useAppStore.getState().releaseClosedSession(sessionId);
}

export async function confirmSideChatDiscard(sessionId: string): Promise<boolean> {
  let backgroundRunning: boolean;
  try {
    const { tasks } = await api.backgroundTasksList();
    backgroundRunning = tasks.some((task) => task.sessionId === sessionId && task.state === "running");
  } catch (error) {
    useAppStore.getState().showToast(String(error), { variant: "error" });
    return false;
  }
  const state = useAppStore.getState();
  const draft = readLiveComposerDraft(sessionId);
  const busy = Boolean(
    backgroundRunning || draft?.text.trim() ||
      draft?.fileReferences.length ||
      draft?.quotes?.length ||
      state.runningSessions[sessionId] ||
      state.backgroundDelegations[sessionId] ||
      state.queuedPrompts[sessionId]?.length ||
      state.pendingPermissions[sessionId]?.length ||
      state.pendingAsks[sessionId]?.length,
  );
  const pendingPlan = state.pendingPlans[sessionId]?.status === "pending";
  return !(busy || pendingPlan) || confirmSideChatClose();
}
