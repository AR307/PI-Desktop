import type { AgentHost } from "@pi-desktop/agent-host";
import { toSessionSummary, type HostRpc } from "@pi-desktop/host-runtime";
import type { AppSettings, MobileSession, MobileSessionConfiguration, ProviderPublic, SessionSummary } from "@pi-desktop/shared";
import type { ImageService } from "../images/service";
import { currentTurnConfiguration } from "../services/session-configuration";

export type SessionProjectionDependencies = { host(): HostRpc; agent(): AgentHost; images: Pick<ImageService, "states"> };

/**
 * Reads shared by every session described for one request. A directory page
 * describes up to a hundred sessions; reading settings and provider groups
 * once per page keeps it from issuing two host RPCs per row.
 */
export type ProjectionContext = { settings: AppSettings; groupNames: Map<string, Promise<string | undefined>> };

export async function projectionContext(host: HostRpc): Promise<ProjectionContext> {
  return { settings: await host.call<AppSettings>("settings.get"), groupNames: new Map() };
}

function groupName(host: HostRpc, context: ProjectionContext, providerId: string): Promise<string | undefined> {
  let pending = context.groupNames.get(providerId);
  if (!pending) {
    pending = host.call<{ provider?: ProviderPublic }>("providers.get", { id: providerId }).then(({ provider }) => provider?.mirrorCoding?.groupName);
    context.groupNames.set(providerId, pending);
  }
  return pending;
}

export function canPrompt(record: SessionSummary): boolean {
  return record.capabilities?.canPrompt ?? record.source !== "pi-native";
}

/** The mobile session projection: actual model/group, task mode and the current/next configuration split. */
export async function describeMobileSession(deps: SessionProjectionDependencies, record: SessionSummary, provided?: ProjectionContext): Promise<MobileSession> {
  const host = deps.host();
  const context = provided ?? await projectionContext(host);
  const config = context.settings.imageSessions?.[record.id];
  const image = config?.active === true;
  const providerId = image ? config.providerId : record.providerId;
  const modelId = image ? config?.modelId : record.modelId;
  const groupNameValue = providerId ? await groupName(host, context, providerId) : undefined;
  const agent = deps.agent();
  const described = agent.describeSession(toSessionSummary(record));
  const attentionCounts = { approvals: agent.pendingApprovals(record.id).length, inputs: agent.pendingInputRequests(record.id).length };
  const taskMode = image ? "image" : record.mode;
  const busy = Boolean(described.activeTurnId || described.queuedTurnIds.length || deps.images.states().some((job) => job.sessionId === record.id && job.status === "running"));
  const approvalPending = described.planningState === "awaiting_approval";
  const next = {
    mode: taskMode,
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(image ? { ultra: false, fast: false } : { thinkingLevel: record.thinkingLevel, ultra: record.ultra === true, fast: record.fast === true }),
    ...(config ? { imageConfig: config } : {}),
  } satisfies MobileSessionConfiguration["next"];
  const chat = {
    mode: record.mode,
    ultra: record.ultra === true, fast: record.fast === true,
    ...(record.providerId ? { providerId: record.providerId } : {}),
    ...(record.modelId ? { modelId: record.modelId } : {}),
    ...(record.thinkingLevel ? { thinkingLevel: record.thinkingLevel } : {}),
  } satisfies NonNullable<MobileSessionConfiguration["chat"]>;
  const configuration: MobileSessionConfiguration = {
    mode: taskMode,
    ...(described.activeTurnId ? { current: currentTurnConfiguration(host, record.id) }
      : image && busy ? { current: next } : {}),
    next,
    chat,
    ...(config ? { image: { mode: "image", ...(config.providerId ? { providerId: config.providerId } : {}), ...(config.modelId ? { modelId: config.modelId } : {}), imageConfig: config } } : {}),
    canConfigure: canPrompt(record),
    pendingTurn: busy,
    ...(!canPrompt(record) ? { blockedReason: "read_only" as const } : busy ? { blockedReason: "running" as const } : approvalPending ? { blockedReason: "approval_pending" as const } : {}),
  };
  return { ...described, providerId, modelId, thinkingLevel: record.thinkingLevel, ultra: !image && record.ultra === true, fast: !image && record.fast === true,
    groupName: groupNameValue, taskMode, ...(config ? { imageConfig: config } : {}), configuration, attentionCounts,
    capabilities: { canPrompt: canPrompt(record), canStop: record.capabilities?.canStop ?? record.source !== "pi-native" } };
}
