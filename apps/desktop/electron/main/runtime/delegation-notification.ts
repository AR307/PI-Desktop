import type { AgentPromptRequest } from "@pi-desktop/shared";

// Private main-process marker; IPC JSON cannot manufacture a symbol property.
export const delegationNotification = Symbol("delegationNotification");
export type InternalAgentPrompt = AgentPromptRequest & { [delegationNotification]?: true };
