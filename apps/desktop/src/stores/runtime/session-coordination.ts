import type {
  ContextCompactionRecord,
  SessionDetail,
  SessionSummary,
  UiMessage,
} from "@pi-desktop/shared";
import {
  contextCompactionMark,
  initialThinkingLevelForBinding,
  initialThinkingLevelForUnmatchedModel,
  normalizeMode,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { sameComposerModelId } from "../../lib/composer-models";
import { scheduleHomeDraftAdopt } from "../../lib/composer-draft-cache";
import {
  commitForkedSessionState,
  forkedSessionMessages,
  FORKED_SESSION_WINDOW,
} from "../../lib/session-fork";
import { EMPTY_SESSION_WINDOW } from "../../lib/session-create";
import { newConversationModelBinding } from "../../lib/session-model";
import {
  clearSessionPanes,
  retainSessionPane,
} from "../../lib/session-panes";
import {
  sessionIsArchived,
  sessionIsPinned,
} from "../../lib/sidebar-preferences";
import type { AppState, DraftSessionConfiguration } from "../app-state";
import type { SessionRuntime } from "./session-runtime";
import type { StoreAccess } from "../slices/types";
import { switchWorkPanelSession } from "../slices/work-panel-slice";

export type PersistSessionOptions = {
  intent?: number;
  projectPath?: string | null;
  draftConfiguration?: DraftSessionConfiguration | null;
};

export type SessionCoordination = {
  rememberSessionCompactions: (
    sessionId: string,
    session:
      | {
          compaction?: ContextCompactionRecord;
          compactions?: ContextCompactionRecord[];
        }
      | null
      | undefined,
  ) => void;
  commitForkedSession: (
    session: SessionDetail,
    options: { activate: boolean; clearError?: boolean },
  ) => void;
  persistSessionAndSelect: (
    options?: PersistSessionOptions,
  ) => Promise<string | null>;
  materializeDraftSession: (intent?: number) => Promise<string | null>;
};

export type SessionCoordinationDependencies = StoreAccess & {
  runtime: SessionRuntime;
  decorateSessions: (
    sessions: SessionSummary[],
    meta: AppState["sessionMeta"],
  ) => SessionSummary[];
  withoutRecordKey: <T>(record: Record<string, T>, key: string) => Record<string, T>;
  untitledTaskTitle: () => string;
};

export function createSessionCoordination({
  get,
  set,
  runtime,
  decorateSessions,
  withoutRecordKey,
  untitledTaskTitle,
}: SessionCoordinationDependencies): SessionCoordination {
  function rememberSessionCompactions(
    sessionId: string,
    session:
      | {
          compaction?: ContextCompactionRecord;
          compactions?: ContextCompactionRecord[];
        }
      | null
      | undefined,
  ): void {
    const records =
      session?.compactions ??
      (session?.compaction ? [session.compaction] : []);
    const marks = records.map((record) => ({ ...contextCompactionMark(record), summary: record.summary }));
    set((state) => ({
      sessionCompactions:
        marks.length > 0
          ? { ...state.sessionCompactions, [sessionId]: marks }
          : withoutRecordKey(state.sessionCompactions, sessionId),
    }));
  }

  function commitForkedSession(
    session: SessionDetail,
    options: { activate: boolean; clearError?: boolean },
  ): void {
    const { messages: _forkedMessages, ...summary } = session;
    const messages = forkedSessionMessages(session);
    const historyWindow = { ...FORKED_SESSION_WINDOW };
    runtime.cacheSessionTranscript(summary.id, messages, historyWindow);
    set((current) => {
      const commit = commitForkedSessionState(current, summary, {
        activate: options.activate,
      });
      const shared: Partial<AppState> = {
        sessions: decorateSessions(commit.sessions, current.sessionMeta),
        sessionHistory: {
          ...current.sessionHistory,
          [summary.id]: historyWindow,
        },
        planningStates: {
          ...current.planningStates,
          [summary.id]: summary.mode === "plan" ? "planning" : "inactive",
        },
        ...(options.clearError ? { error: null, errorCode: null } : {}),
      };
      if (!commit.activated) return shared;
      return {
        ...switchWorkPanelSession(current, summary.id),
        ...shared,
        ...retainSessionPane(current, summary.id, messages),
        activeSessionId: summary.id,
        messages,
        page: "chat" as const,
        isRunning: false,
        navStack: commit.navStack as AppState["navStack"],
        navIndex: commit.navIndex,
      };
    });
    rememberSessionCompactions(summary.id, session);
    void get().restorePendingPlan(summary.id);
  }

  function revealEmptyCreatingSession(intent: number): void {
    if (!runtime.navigationIntentIsCurrent(intent)) return;
    set((state) => {
      if (
        !state.activeSessionId &&
        state.page === "chat" &&
        state.messages.length === 0 &&
        state.retainedSessionIds.length === 0
      ) {
        return {};
      }
      return {
        ...switchWorkPanelSession(state, undefined),
        ...clearSessionPanes(),
        activeSessionId: undefined,
        selectingSessionId: undefined,
        messages: [],
        page: "chat" as const,
        isRunning: false,
      };
    });
  }

  function commitCreatedEmptySession(
    summary: SessionSummary,
    options: { activate: boolean },
  ): void {
    const messages: UiMessage[] = [];
    runtime.cacheSessionTranscript(summary.id, messages, EMPTY_SESSION_WINDOW);
    if (options.activate) scheduleHomeDraftAdopt(summary.id);
    set((current) => {
      const commit = commitForkedSessionState(current, summary, {
        activate: options.activate,
      });
      const shared: Partial<AppState> = {
        sessions: decorateSessions(commit.sessions, current.sessionMeta),
        sessionHistory: {
          ...current.sessionHistory,
          [summary.id]: EMPTY_SESSION_WINDOW,
        },
        planningStates: {
          ...current.planningStates,
          [summary.id]: summary.mode === "plan" ? "planning" : "inactive",
        },
      };
      if (!commit.activated) return shared;
      return {
        ...switchWorkPanelSession(current, summary.id),
        ...shared,
        ...retainSessionPane(current, summary.id, messages),
        activeSessionId: summary.id,
        selectingSessionId: undefined,
        draftConfiguration: null,
        messages,
        page: "chat" as const,
        isRunning: current.runningSessions[summary.id] ?? false,
        navStack: commit.navStack as AppState["navStack"],
        navIndex: commit.navIndex,
      };
    });
  }

  async function persistSessionAndSelect(
    options: PersistSessionOptions = {},
  ): Promise<string | null> {
    const active = options.intent ?? runtime.beginNavigationIntent();
    const state = get();
    const settings = state.settings;
    const projectPath =
      options && "projectPath" in options
        ? options.projectPath ?? null
        : state.workspace?.path ?? null;
    const draftConfig =
      options && "draftConfiguration" in options
        ? options.draftConfiguration
        : state.draftConfiguration;
    const inherited = newConversationModelBinding({
      draft: draftConfig,
      latestSession: runtime.latestSessionInScope(
        state.sessions,
        projectPath,
        state.sessionMeta,
      ),
      settings,
      providers: state.providers,
    });
    const defaultProvider = state.providers.find(
      (provider) => provider.id === inherited.providerId,
    );
    const inheritedBinding = defaultProvider?.models.find((candidate) =>
      sameComposerModelId(candidate.id, inherited.modelId ?? ""),
    );
    const catalogModel = inherited.providerId && inherited.modelId
      ? state.providerModels[inherited.providerId]?.find((candidate) =>
          sameComposerModelId(candidate.modelId, inherited.modelId ?? ""),
        )
      : undefined;
    const defaultThinkingLevel = catalogModel?.catalogSource === "models.dev"
      ? initialThinkingLevelForBinding(
          inheritedBinding,
          defaultProvider?.supportedThinkingLevels,
        )
      : initialThinkingLevelForUnmatchedModel(
          inheritedBinding,
          defaultProvider?.supportedThinkingLevels,
        );
    const previousSessionId = state.activeSessionId;
    revealEmptyCreatingSession(active);
    let created: Awaited<ReturnType<typeof api.createSession>>;
    try {
      created = await api.createSession({
        title: untitledTaskTitle(),
        mode: draftConfig?.mode ?? normalizeMode(settings?.defaultMode),
        thinkingLevel: draftConfig?.thinkingLevel ?? defaultThinkingLevel,
        permissionMode: draftConfig?.permissionMode,
        providerId: inherited.providerId,
        modelId: inherited.modelId,
        projectPath: projectPath ?? undefined,
      });
    } catch (error) {
      if (previousSessionId && runtime.navigationIntentIsCurrent(active)) {
        void get().selectSession(previousSessionId, {
          navigationIntent: active,
        });
      }
      throw error;
    }
    const sessionId = created.session.id;
    if (draftConfig?.fast === true) {
      const configured = await api.configureSession(sessionId, { mode: created.session.mode, fast: true });
      if (configured.session) created.session = { ...created.session, ...configured.session };
    }
    if (!runtime.navigationIntentIsCurrent(active)) {
      commitCreatedEmptySession(created.session, { activate: false });
      return null;
    }
    commitCreatedEmptySession(created.session, { activate: true });
    return sessionId;
  }

  async function materializeDraftSession(
    intent?: number,
  ): Promise<string | null> {
    const state = get();
    const scopeKey = runtime.newSessionScopeKey(state.workspace?.path ?? null);
    const pending = runtime.pendingNewSessionRequests.get(scopeKey);
    if (pending) {
      await pending;
      const activeId = get().activeSessionId;
      if (activeId) return activeId;
    }
    return persistSessionAndSelect({ intent });
  }

  return {
    rememberSessionCompactions,
    commitForkedSession,
    persistSessionAndSelect,
    materializeDraftSession,
  };
}
