import i18n from "i18next";
import { api } from "./api";
import { useAppStore } from "../stores/app-store";
import { trustedExtensionCommandName, type Mode } from "@pi-desktop/shared";

/**
 * First-party command execution shared by the command palette and the
 * composer "/" dispatch (D123). Builtin ids run app actions locally; other
 * ids round-trip to the plugin runtime via commandPalette/execute.
 */
export async function runPaletteCommand(commandId: string, targetSessionId?: string): Promise<void> {
  const store = useAppStore.getState();
  const sessionId = targetSessionId ?? store.activeSessionId;
  switch (commandId) {
    case "builtin.session.new":
      if (sessionId?.startsWith("side-")) throw new Error(i18n.t("chat.sideChat.mainCommand"));
      await store.newSession();
      break;
    case "builtin.agent.compact":
      await store.compactContext(sessionId);
      break;
    case "builtin.mode.agent":
    case "builtin.mode.plan":
    case "builtin.mode.goal": {
      const mode: Mode = commandId.endsWith("plan")
        ? "plan"
        : commandId.endsWith("goal")
          ? "goal"
          : "agent";
      const activeSession = sessionId
        ? store.sessions.find((session) => session.id === sessionId)
        : undefined;
      if (activeSession) {
        await store.configureActiveSession({
          mode,
          providerId: activeSession.providerId,
          modelId: activeSession.modelId,
          thinkingLevel: activeSession.thinkingLevel,
        }, sessionId);
      } else if (store.settings) {
        // Keep the command useful from the empty home, where no session has
        // been created yet. The next session will inherit this default.
        const next = { ...store.settings, defaultMode: mode };
        await api.setSettings(next);
        useAppStore.setState({ settings: next });
      }
      break;
    }
    default: {
      // Trusted extension commands run inside the active session's sidecar
      // (spec 16 §8); without a session there is nothing to run them in.
      const extensionCommand = trustedExtensionCommandName(commandId);
      if (extensionCommand !== undefined) {
        await runExtensionCommand(extensionCommand, "", sessionId);
        return;
      }
      if (sessionId?.startsWith("side-")) throw new Error(i18n.t("chat.sideChat.mainCommand"));
      await api.executeCommand(commandId);
    }
  }
}

export async function runExtensionCommand(name: string, args: string, targetSessionId?: string): Promise<void> {
  const store = useAppStore.getState();
  const sessionId = targetSessionId ?? store.activeSessionId;
  if (!sessionId) {
    throw new Error(i18n.t("plugins.agentExtension.commandNeedsSession"));
  }
  await api.runExtensionCommand({ sessionId, name, args });
}
