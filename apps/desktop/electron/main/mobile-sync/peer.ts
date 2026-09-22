import { randomUUID } from "node:crypto";
import { RacpError, type AgentHost, type Principal } from "@pi-desktop/agent-host";
import { toSessionSummary, type HostRpc } from "@pi-desktop/host-runtime";
import { encodeFrame, errorObjectFrom, isRequest, parseFrame } from "@pi-desktop/racp/framing";
import {
  APP_VERSION, RACP_DEFAULT_LIMITS, RACP_DEFAULT_POLICY, RACP_EVENT_NOTIFICATION, RACP_PROTOCOL_VERSION, RACP_SUBSCRIPTION_CLOSED_NOTIFICATION,
  SESSION_THINKING_LEVELS, validateImageOptions,
  protocolVersionsCompatible, type AppSettings, type MobileGrant, type MobileSession, type MobileSessionConfiguration, type MobileSessionConfigureInput, type MobileSessionSnapshot,
  type RacpApprovalResponse, type RacpCursor, type RacpEventEnvelope, type RacpInitializeResult, type RacpInputResponse,
  type ProviderPublic, type SessionSummary, type SessionDetail, type PlanProposal, type ThinkingLevel,
} from "@pi-desktop/shared";
import type { ImageService } from "../images/service";
import type { MirrorCodingAccount } from "../mirrorcoding/account";
import { MobileAttachments } from "./attachments";
import { buildMobileModelCatalog } from "./catalog";
import type { MobileScopeAccess } from "./scope";
import { integer, object, string } from "./validation";

export type MobilePeerDependencies = {
  peerId: string; deviceId: string; desktopDeviceId: string; dataDir: string;
  host(): HostRpc; agent(): AgentHost; account: MirrorCodingAccount; images: ImageService; scope: MobileScopeAccess;
  grants(): MobileGrant[]; send(frame: string): void; close(reason: string): void;
};

/** The mobile profile deliberately exposes only shared-session controls. */
export class MobilePeer {
  private initialized = false;
  private closed = false;
  private subscriptions = new Map<string, string>();
  private delivery: Promise<void> = Promise.resolve();
  private pendingEvents = 0;
  private activeConfigurations = new Map<string, MobileSessionConfiguration["next"]>();
  private queuedConfigurations = new Map<string, MobileSessionConfiguration["next"]>();
  private attachments: MobileAttachments;
  private stopImages: () => void;
  private stopConfiguration: () => void;
  readonly principal: Principal;
  constructor(private deps: MobilePeerDependencies) {
    this.principal = { subject: `mobile:${deps.deviceId}`, connectionId: deps.peerId, roles: ["owner"], pairedDevice: true };
    this.attachments = new MobileAttachments(deps.dataDir, deps.host);
    this.stopImages = deps.images.subscribe((imageState) => {
      if (![...this.subscriptions.values()].includes(imageState.sessionId)) return;
      if (imageState.status !== "running") this.activeConfigurations.delete(imageState.sessionId);
      void this.deliverActivity(imageState.sessionId, { imageState });
    });
    this.stopConfiguration = deps.images.subscribeConfiguration((sessionId) => {
      if ([...this.subscriptions.values()].includes(sessionId)) void this.deliverActivity(sessionId, { configurationChanged: true });
    });
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const [id, sessionId] of this.subscriptions) this.deps.agent().unsubscribe(id, sessionId);
    this.subscriptions.clear(); this.attachments.dispose(); this.stopImages(); this.stopConfiguration(); this.activeConfigurations.clear(); this.queuedConfigurations.clear();
  }
  desktopChanged() { for (const sessionId of new Set(this.subscriptions.values())) void this.deliverActivity(sessionId, { configurationChanged: true }); }
  async frame(frame: string) {
    if (this.closed) return;
    if (Buffer.byteLength(frame) > RACP_DEFAULT_LIMITS.maxFrameBytes) { this.deps.close("PAYLOAD_TOO_LARGE"); return; }
    const message = parseFrame(frame);
    if (!message || !isRequest(message)) return;
    try {
      const result = await this.dispatch(message.method, object(message.params ?? {}));
      if (message.method !== "connection/initialize") {
        if (!this.deps.grants().length) throw new RacpError("FORBIDDEN", "share_revoked");
        const params = object(message.params ?? {});
        if (typeof params.sessionId === "string") await this.require(params.sessionId);
      }
      if (!this.closed) this.deps.send(encodeFrame({ jsonrpc: "2.0", id: message.id, result }));
    } catch (error) {
      if (!this.closed) this.deps.send(encodeFrame({ jsonrpc: "2.0", id: message.id, error: errorObjectFrom(error, randomUUID()) }));
    }
  }
  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "connection/initialize") return this.initialize(params);
    if (!this.initialized) throw new RacpError("PROTOCOL_MISMATCH", "connection_not_initialized");
    if (!this.deps.grants().length) throw new RacpError("FORBIDDEN", "share_revoked");
    if (method === "connection/ping") return { ok: true, serverTime: new Date().toISOString() };
    if (method === "session/list") {
      const grants = this.deps.grants().filter((grant) => params.grantId === undefined || grant.id === params.grantId);
      if (!grants.length) throw new RacpError("FORBIDDEN", "share_not_authorized");
      const records = await this.deps.scope.sessions(grants);
      return { sessions: await Promise.all(records.map((session) => this.describe(session))) };
    }
    if (method === "events/unsubscribe" || method === "events/ack") {
      const id = string(params.subscriptionId, "subscription_id");
      const sessionId = this.subscriptions.get(id);
      if (!sessionId) return { removed: false };
      await this.require(sessionId);
      if (method === "events/ack") { this.deps.agent().ack(id, integer(params.sequence, "sequence")); return { acknowledged: true }; }
      this.subscriptions.delete(id);
      return { removed: this.deps.agent().unsubscribe(id, sessionId) };
    }
    const sessionId = string(params.sessionId, "session_id");
    const session = await this.require(sessionId);
    const agent = this.deps.agent();
    switch (method) {
      case "session/get": return { session: await this.describe(session) };
      case "session/modelCatalog": return { catalog: await this.modelCatalog() };
      case "session/configure": return { session: await this.configure(session, params) };
      case "session/attach": {
        const result = await agent.attach(this.principal, { sessionId, includeSnapshot: false, ...(params.after ? { after: cursor(params.after) } : {}) });
        return { ...result, session: await this.describe(session), snapshot: await this.snapshot(session) };
      }
      case "session/snapshot": return { snapshot: await this.snapshot(session) };
      case "session/history": return agent.history(this.principal, { sessionId, ...(params.beforeItemId ? { beforeItemId: string(params.beforeItemId, "before_item_id") } : {}), limit: integer(params.limit ?? 50, "limit", 200) || 1 });
      case "message/status": {
        const messageId = string(params.messageId, "message_id");
        const snapshot = await agent.snapshot(sessionId);
        if (snapshot.activeTurn?.idempotencyKey === messageId || this.deps.images.states().some((job) => job.sessionId === sessionId && job.jobId === messageId)) return { status: "running" };
        if (snapshot.queuedTurns.some((turn) => turn.idempotencyKey === messageId)) return { status: "queued" };
        const result = await this.deps.host().call<{ session?: SessionDetail }>("session.get", { id: sessionId, messageAround: messageId, messageLimit: 1, contentLimit: 1 });
        return { status: result.session?.messages.some((message) => message.id === messageId) ? "persisted" : "unknown" };
      }
      case "events/subscribe": {
        if (params.scope !== "session") throw new RacpError("FORBIDDEN", "session_subscription_required");
        if (this.subscriptions.size >= RACP_DEFAULT_LIMITS.maxSubscriptionsPerConnection) throw new RacpError("RATE_LIMITED", "too_many_subscriptions");
        const result = agent.subscribe(this.principal, { scope: "session", sessionId, ...(params.after ? { after: cursor(params.after) } : {}) }, {
          deliver: (event) => this.deliver(event),
          close: (error, lastSafeCursor) => queueMicrotask(() => { if (!this.closed) this.deps.send(encodeFrame({ jsonrpc: "2.0", method: RACP_SUBSCRIPTION_CLOSED_NOTIFICATION, params: { subscriptionId: result.subscriptionId, error: errorObjectFrom(error, randomUUID()).data, lastSafeCursor } })); }),
        });
        this.subscriptions.set(result.subscriptionId, sessionId);
        return result;
      }
      case "turn/start": return this.start(session, params);
      case "turn/stop":
      case "turn/interrupt": {
        if (session.capabilities?.canStop === false) throw new RacpError("FORBIDDEN", "session_read_only");
        if (this.deps.images.abortSession(sessionId)) return { requested: true };
        const snapshot = await agent.snapshot(sessionId);
        if (!snapshot.activeTurn) return { requested: false };
        return method === "turn/interrupt" ? agent.interruptTurn(this.principal, snapshot.activeTurn.id) : agent.stopTurn(this.principal, snapshot.activeTurn.id);
      }
      case "turn/cancel": {
        const turnId = string(params.turnId, "turn_id");
        if (agent.getTurn(turnId).sessionId !== sessionId) throw new RacpError("FORBIDDEN", "turn_not_in_session");
        return agent.cancelTurn(this.principal, turnId);
      }
      case "approval/respond": {
        const approvalId = string(params.approvalId, "approval_id");
        const approval = agent.pendingApprovals(sessionId).find((item) => item.id === approvalId);
        if (!approval) throw new RacpError("CONFLICT", "approval_already_resolved");
        const decision = string(params.decision, "decision") as RacpApprovalResponse["decision"];
        if (!approval.allowedDecisions.includes(decision)) throw new RacpError("INVALID_ARGUMENT", "invalid_decision");
        const permissionMode = params.permissionMode as RacpApprovalResponse["permissionMode"];
        if (permissionMode && !approval.allowedPermissionModes?.includes(permissionMode)) throw new RacpError("INVALID_ARGUMENT", "invalid_permission_mode");
        return agent.respondApproval(this.principal, { approvalId, decision, ...(permissionMode ? { permissionMode } : {}), context: { requestId: randomUUID() } });
      }
      case "input/respond": {
        const inputId = string(params.inputId, "input_id");
        const snapshot = await agent.snapshot(sessionId);
        if (!snapshot.pendingInputs.some((input) => input.id === inputId)) throw new RacpError("CONFLICT", "input_already_resolved");
        if (!Array.isArray(params.answers) || !params.answers.every((answer) => answer === null || Array.isArray(answer) && answer.every((value) => typeof value === "string"))) throw new RacpError("INVALID_ARGUMENT", "invalid_answers");
        return agent.respondInput(this.principal, { inputId, answers: params.answers as RacpInputResponse["answers"], context: { requestId: randomUUID() } });
      }
      case "attachment/create": return this.attachments.create(sessionId, params);
      case "attachment/write": return this.attachments.write(sessionId, params);
      case "attachment/complete": return this.attachments.complete(sessionId, params);
      case "attachment/read": return this.attachments.read(sessionId, params);
      case "image/retryDownload": return this.deps.images.retryDownload(sessionId, string(params.messageId, "message_id"), string(params.imageId, "image_id"));
      default: throw new RacpError("METHOD_NOT_FOUND", "mobile_operation_not_supported");
    }
  }
  private initialize(params: Record<string, unknown>): RacpInitializeResult {
    if (!protocolVersionsCompatible(RACP_PROTOCOL_VERSION, string(params.protocolVersion, "protocol_version"))) throw new RacpError("PROTOCOL_MISMATCH", "protocol_version_mismatch");
    this.initialized = true;
    return { protocolVersion: RACP_PROTOCOL_VERSION, server: { name: "PI Desktop Mobile", version: APP_VERSION, hostId: this.deps.desktopDeviceId }, connectionId: this.deps.peerId,
      principal: { subject: this.principal.subject, roles: [...this.principal.roles] }, limits: RACP_DEFAULT_LIMITS, policy: RACP_DEFAULT_POLICY,
      capabilities: { eventReplay: true, snapshot: true, approvals: true, inputRequests: true, attachments: true, serverRequests: false, turnQueue: true, hostEvents: false, history: true, remoteHostProfile: false, toolRelay: false, terminal: false, notifications: false, bindings: ["RACP-WS"] } };
  }
  private async require(sessionId: string) {
    if (this.closed) throw new RacpError("HOST_DISCONNECTED", "connection_closed");
    return this.deps.scope.require(sessionId, this.deps.grants());
  }
  private async configure(record: SessionSummary, params: Record<string, unknown>): Promise<MobileSession> {
    if (!canPrompt(record)) throw new RacpError("FORBIDDEN", "session_read_only");
    const settings = await this.deps.host().call<AppSettings>("settings.get");
    const current = await this.describe(record, settings);
    const input = parseConfiguration(params);
    const requestedMode = input.mode ?? current.taskMode;
    const currentMode = current.taskMode;
    const snapshot = await this.deps.agent().snapshot(record.id);
    const imageBusy = this.deps.images.states().some((job) => job.sessionId === record.id && job.status === "running");
    const busy = Boolean(snapshot.activeTurn || snapshot.queuedTurns.length || imageBusy);
    const approvalPending = snapshot.session.planningState === "awaiting_approval" || snapshot.pendingApprovals.length > 0;
    if (requestedMode !== currentMode && (busy || approvalPending)) {
      throw new RacpError("CONFLICT", approvalPending ? "SESSION_CONFIGURATION_APPROVAL_PENDING" : "SESSION_CONFIGURATION_BUSY");
    }

    const catalog = await this.modelCatalog();
    const choices = requestedMode === "image" ? catalog.image : catalog.chat;
    const providerId = input.providerId ?? (requestedMode === "image" ? current.configuration?.image?.providerId ?? current.imageConfig?.providerId : current.configuration?.chat?.providerId ?? record.providerId);
    const modelId = input.modelId ?? (requestedMode === "image" ? current.configuration?.image?.modelId ?? current.imageConfig?.modelId : current.configuration?.chat?.modelId ?? record.modelId);
    const choice = providerId && modelId ? choices.find((candidate) => candidate.providerId === providerId && candidate.modelId === modelId) : undefined;
    if ((providerId || modelId) && !choice) throw new RacpError("INVALID_ARGUMENT", "model_or_group_unavailable");
    const requestedThinking = input.thinkingLevel ?? (requestedMode === "image" ? undefined : record.thinkingLevel);
    const effectiveThinking = choice && requestedThinking && requestedThinking !== "omit" && !choice.supportedThinkingLevels.includes(requestedThinking as ThinkingLevel)
      ? choice.supportedThinkingLevels[0] ?? "off"
      : requestedThinking;

    if (requestedMode === "image") {
      if (!choice?.image) throw new RacpError("INVALID_ARGUMENT", "image_model_not_selected");
      const imageConfig = input.imageConfig ?? current.imageConfig ?? { active: true, options: { count: 1 } };
      let options = imageConfig.options;
      try {
        options = validateImageOptions(choice.image, imageConfig.options);
      } catch (error) {
        throw new RacpError("INVALID_ARGUMENT", error instanceof Error ? error.message : "invalid_image_options");
      }
      await this.deps.host().call("session.configure", { id: record.id, mode: "agent" });
      try {
        await this.deps.images.configure(record.id, {
          active: true,
          providerId: choice.providerId,
          modelId: choice.modelId,
          options,
        });
      } catch (error) {
        await rethrowAfterRollback(error, this.deps.host, record);
      }
    } else {
      await this.deps.host().call("session.configure", {
        id: record.id,
        mode: requestedMode,
        ...(providerId !== undefined ? { providerId } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(effectiveThinking !== undefined ? { thinkingLevel: effectiveThinking } : {}),
      });
      if (currentMode === "image") {
        try {
          await this.deps.images.configure(record.id, { active: false, providerId: current.imageConfig?.providerId, modelId: current.imageConfig?.modelId, options: current.imageConfig?.options ?? { count: 1 } });
        } catch (error) {
          await rethrowAfterRollback(error, this.deps.host, record);
        }
      }
    }
    const updatedRecord: SessionSummary = {
      ...record,
      mode: requestedMode === "image" ? "agent" : requestedMode,
      ...(requestedMode === "image" ? {} : {
        ...(providerId !== undefined ? { providerId } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(effectiveThinking !== undefined ? { thinkingLevel: effectiveThinking } : {}),
      }),
    };
    return this.describe(updatedRecord);
  }
  private async describe(record: SessionSummary, providedSettings?: AppSettings): Promise<MobileSession> {
    const settings = providedSettings ?? await this.deps.host().call<AppSettings>("settings.get");
    const config = settings.imageSessions?.[record.id];
    const image = config?.active === true;
    const providerId = image ? config.providerId : record.providerId;
    const modelId = image ? config?.modelId : record.modelId;
    let groupName: string | undefined;
    if (providerId) {
      const { provider } = await this.deps.host().call<{ provider?: ProviderPublic }>("providers.get", { id: providerId });
      groupName = provider?.mirrorCoding?.groupName;
    }
    const described = this.deps.agent().describeSession(toSessionSummary(record));
    const taskMode = image ? "image" : record.mode;
    const busy = Boolean(described.activeTurnId || described.queuedTurnIds.length || this.deps.images.states().some((job) => job.sessionId === record.id && job.status === "running"));
    const approvalPending = described.planningState === "awaiting_approval";
    const next = {
      mode: taskMode,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(image ? {} : { thinkingLevel: record.thinkingLevel }),
      ...(config ? { imageConfig: config } : {}),
    } satisfies MobileSessionConfiguration["next"];
    const chat = {
      mode: record.mode,
      ...(record.providerId ? { providerId: record.providerId } : {}),
      ...(record.modelId ? { modelId: record.modelId } : {}),
      ...(record.thinkingLevel ? { thinkingLevel: record.thinkingLevel } : {}),
    } satisfies NonNullable<MobileSessionConfiguration["chat"]>;
    const configuration: MobileSessionConfiguration = {
      mode: taskMode,
      ...(this.activeConfigurations.has(record.id) ? { current: this.activeConfigurations.get(record.id) } : {}),
      next,
      chat,
      ...(config ? { image: { mode: "image", ...(config.providerId ? { providerId: config.providerId } : {}), ...(config.modelId ? { modelId: config.modelId } : {}), imageConfig: config } } : {}),
      canConfigure: canPrompt(record),
      pendingTurn: busy,
      ...(!canPrompt(record) ? { blockedReason: "read_only" as const } : busy ? { blockedReason: "running" as const } : approvalPending ? { blockedReason: "approval_pending" as const } : {}),
    };
    return { ...described, providerId, modelId, thinkingLevel: record.thinkingLevel,
      groupName, taskMode, ...(config ? { imageConfig: config } : {}), configuration,
      capabilities: { canPrompt: canPrompt(record), canStop: record.capabilities?.canStop ?? record.source !== "pi-native" } };
  }
  private async snapshot(record: SessionSummary): Promise<MobileSessionSnapshot> {
    const { plans } = await this.deps.host().call<{ plans: PlanProposal[] }>("plans.pending", { sessionId: record.id });
    return { ...await this.deps.agent().snapshot(record.id), session: await this.describe(record), imageJobs: this.deps.images.states().filter((job) => job.sessionId === record.id), plans };
  }
  private modelCatalog() {
    return buildMobileModelCatalog({
      host: this.deps.host,
      images: this.deps.images,
      isMirrorCodingReady: (provider) => {
        const account = this.deps.account.snapshot();
        return account.status === "connected" && account.account?.id === provider.accountId;
      },
    });
  }
  private async start(session: SessionSummary, params: Record<string, unknown>) {
    const description = await this.describe(session);
    if (!description.capabilities.canPrompt) throw new RacpError("FORBIDDEN", "session_read_only");
    const input = object(params.input);
    const text = string(input.text, "text", true);
    const messageId = string(input.messageId, "message_id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) throw new RacpError("INVALID_ARGUMENT", "invalid_message_id");
    if (Buffer.byteLength(text) > RACP_DEFAULT_LIMITS.maxPromptBytes) throw new RacpError("PAYLOAD_TOO_LARGE", "prompt_too_large");
    const attachments = await this.attachments.resolve(session.id, input.attachments);
    await this.require(session.id);
    if (description.taskMode === "image") {
      const config = description.imageConfig!;
      if (!config.providerId || !config.modelId) throw new RacpError("INVALID_ARGUMENT", "image_model_not_selected");
      if (this.deps.images.states().some((job) => job.sessionId === session.id)) throw new RacpError("CONFLICT", "session_busy");
      const jobId = messageId;
      this.activeConfigurations.set(session.id, configurationValues(description));
      try {
        return await this.deps.images.start({ sessionId: session.id, jobId, messageId, providerId: config.providerId, modelId: config.modelId, prompt: text, references: attachments, options: config.options });
      } catch (error) {
        this.activeConfigurations.delete(session.id);
        throw error;
      }
    }
    const configuration = configurationValues(description);
    const result = await this.deps.agent().startTurn(this.principal, { sessionId: session.id, admission: "queue", idempotencyKey: messageId,
      input: { text, userMessageId: messageId, attachments }, context: { requestId: messageId } });
    if (result.turn.status === "queued") this.queuedConfigurations.set(result.turn.id, configuration);
    else this.activeConfigurations.set(session.id, configuration);
    return result;
  }
  private deliver(event: RacpEventEnvelope) {
    if (this.closed) return;
    if (++this.pendingEvents > 1_000) { this.deps.close("resync_required"); return; }
    this.delivery = this.delivery.then(async () => {
      if (!event.sessionId || this.closed) return;
      try {
        const record = await this.require(event.sessionId);
        if (event.kind === "turn.started") {
          const queued = event.turnId ? this.queuedConfigurations.get(event.turnId) : undefined;
          this.activeConfigurations.set(event.sessionId, queued ?? configurationValues(await this.describe(record)));
          if (event.turnId) this.queuedConfigurations.delete(event.turnId);
        }
      }
      catch { this.deps.close("GRANT_REVOKED"); return; }
      if (!this.closed) {
        if (["turn.completed", "turn.interrupted", "turn.failed", "turn.canceled"].includes(event.kind)) {
          this.activeConfigurations.delete(event.sessionId);
          if (event.turnId) this.queuedConfigurations.delete(event.turnId);
        }
        this.deps.send(encodeFrame({ jsonrpc: "2.0", method: RACP_EVENT_NOTIFICATION, params: event }));
      }
    }).catch(() => this.deps.close("delivery_failed")).finally(() => { this.pendingEvents -= 1; });
  }
  private async deliverActivity(sessionId: string, payload: unknown) {
    try {
      await this.require(sessionId);
      const snapshot = await this.deps.agent().snapshot(sessionId);
      this.deliver({ eventId: randomUUID(), scope: "session", sessionId, epoch: snapshot.cursor.epoch, afterSequence: snapshot.cursor.sequence,
        revision: snapshot.revision, kind: "turn.activity", occurredAt: new Date().toISOString(), payload });
    } catch { this.deps.close("GRANT_REVOKED"); }
  }
}

function configurationValues(session: MobileSession): MobileSessionConfiguration["next"] {
  return {
    mode: session.taskMode,
    ...(session.providerId ? { providerId: session.providerId } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {}),
    ...(session.thinkingLevel ? { thinkingLevel: session.thinkingLevel } : {}),
    ...(session.imageConfig ? { imageConfig: session.imageConfig } : {}),
  };
}

function canPrompt(record: SessionSummary): boolean {
  return record.capabilities?.canPrompt ?? record.source !== "pi-native";
}

function cursor(value: unknown): RacpCursor { const item = object(value); return { epoch: string(item.epoch, "epoch"), sequence: integer(item.sequence, "sequence") }; }

async function rethrowAfterRollback(error: unknown, host: () => HostRpc, record: SessionSummary): Promise<never> {
  try {
    await restoreHostConfiguration(host, record);
  } catch (rollbackError) {
    throw Object.assign(new Error("session_configuration_rollback_failed"), {
      cause: new AggregateError([error, rollbackError]),
    });
  }
  throw error;
}

async function restoreHostConfiguration(host: () => HostRpc, record: SessionSummary): Promise<void> {
  await host().call("session.configure", {
    id: record.id,
    mode: record.mode,
    ...(record.providerId !== undefined ? { providerId: record.providerId } : {}),
    ...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
    ...(record.thinkingLevel !== undefined ? { thinkingLevel: record.thinkingLevel } : {}),
  });
}

function parseConfiguration(params: Record<string, unknown>): MobileSessionConfigureInput {
  const modeValue = params.mode;
  if (modeValue !== undefined && modeValue !== "agent" && modeValue !== "plan" && modeValue !== "goal" && modeValue !== "image") {
    throw new RacpError("INVALID_ARGUMENT", "invalid_task_mode");
  }
  const providerId = params.providerId === undefined ? undefined : string(params.providerId, "provider_id");
  const modelId = params.modelId === undefined ? undefined : string(params.modelId, "model_id");
  const thinkingLevel = params.thinkingLevel === undefined ? undefined : string(params.thinkingLevel, "thinking_level") as MobileSessionConfigureInput["thinkingLevel"];
  if (thinkingLevel !== undefined && !(SESSION_THINKING_LEVELS as readonly string[]).includes(thinkingLevel)) {
    throw new RacpError("INVALID_ARGUMENT", "invalid_thinking_level");
  }
  let imageConfig: MobileSessionConfigureInput["imageConfig"];
  if (params.imageConfig !== undefined) {
    const row = object(params.imageConfig);
    const options = row.options === undefined ? {} : object(row.options);
    imageConfig = {
      active: row.active === true,
      ...(typeof row.providerId === "string" ? { providerId: row.providerId } : {}),
      ...(typeof row.modelId === "string" ? { modelId: row.modelId } : {}),
      options: {
        ...(typeof options.size === "string" ? { size: options.size } : {}),
        ...(typeof options.quality === "string" ? { quality: options.quality } : {}),
        ...(typeof options.aspectRatio === "string" ? { aspectRatio: options.aspectRatio } : {}),
        ...(Number.isInteger(options.count) ? { count: Number(options.count) } : {}),
      },
    };
  }
  return {
    ...(modeValue !== undefined ? { mode: modeValue } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(imageConfig ? { imageConfig } : {}),
  };
}
