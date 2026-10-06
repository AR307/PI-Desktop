import { randomUUID } from "node:crypto";
import { RacpError, type AgentHost, type Principal } from "@pi-desktop/agent-host";
import { toRacpItem, toSessionSummary, type HostRpc } from "@pi-desktop/host-runtime";
import { encodeFrame, errorObjectFrom, isRequest, parseFrame } from "@pi-desktop/racp/framing";
import {
  APP_VERSION, MOBILE_ATTACHMENT_CHUNK_BYTES, MOBILE_ITEM_CONTENT_LIMIT,
  RACP_DEFAULT_LIMITS, RACP_DEFAULT_POLICY, RACP_EVENT_NOTIFICATION, RACP_PROTOCOL_VERSION, RACP_SUBSCRIPTION_CLOSED_NOTIFICATION,
  SESSION_THINKING_LEVELS, validateImageOptions,
  protocolVersionsCompatible, type AppSettings, type MobileDirectoryPage, type MobileGrant, type MobileProject, type MobileSession, type MobileSessionChangesPage, type MobileSessionConfiguration, type MobileSessionConfigureInput, type MobileSessionHistoryPage, type MobileSessionSnapshot, type MobileSessionState, type ProjectGroupRecord, type UiMessage,
  type RacpApprovalResponse, type RacpCursor, type RacpEventEnvelope, type RacpInitializeResult, type RacpInputResponse,
  type ProviderPublic, type SessionSummary, type SessionDetail, type PlanProposal, type ThinkingLevel,
} from "@pi-desktop/shared";
import type { ImageService } from "../images/service";
import type { MirrorCodingAccount } from "../mirrorcoding/account";
import { MobileAttachments } from "./attachments";
import { buildMobileModelCatalog } from "./catalog";
import { fitMobileHistory, fitMobileItem, MOBILE_TRANSCRIPT_PAGE_BYTES } from "./projection";
import type { MobileScopeAccess } from "./scope";
import { integer, object, string } from "./validation";
import { configureSession, currentTurnConfiguration } from "../services/session-configuration";

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
  private directorySubscriptions = new Set<string>();
  private delivery: Promise<void> = Promise.resolve();
  private pendingEvents = 0;
  private attachments: MobileAttachments;
  private stopImages: () => void;
  private stopConfiguration: () => void;
  readonly principal: Principal;
  constructor(private deps: MobilePeerDependencies) {
    this.principal = { subject: `mobile:${deps.deviceId}`, connectionId: deps.peerId, roles: ["owner"], pairedDevice: true };
    this.attachments = new MobileAttachments(deps.dataDir, deps.host);
    this.stopImages = deps.images.subscribe((imageState) => {
      if (![...this.subscriptions.values()].includes(imageState.sessionId)) return;
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
    this.subscriptions.clear(); this.attachments.dispose(); this.stopImages(); this.stopConfiguration();
    this.directorySubscriptions.clear();
  }
  desktopChanged() {
    this.directoryChanged();
    for (const sessionId of new Set(this.subscriptions.values())) void this.deliverActivity(sessionId, { configurationChanged: true });
  }
  directoryChanged() {
    if (this.closed || !this.directorySubscriptions.size || !this.deps.grants().length) return;
    this.deps.send(encodeFrame({ jsonrpc: "2.0", method: "mobile.directoryChanged", params: { desktopDeviceId: this.deps.desktopDeviceId } }));
  }
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
    if (method === "directory/list") return this.directory(params);
    if (method === "directory/subscribe") {
      const subscriptionId = randomUUID();
      this.directorySubscriptions.add(subscriptionId);
      return { subscriptionId };
    }
    if (method === "session/list") {
      const grants = this.deps.grants().filter((grant) => params.grantId === undefined || grant.id === params.grantId);
      if (!grants.length) throw new RacpError("FORBIDDEN", "share_not_authorized");
      const records = await this.deps.scope.sessions(grants);
      return { sessions: await Promise.all(records.map((session) => this.describe(session))) };
    }
    if (method === "events/unsubscribe" || method === "events/ack") {
      const id = string(params.subscriptionId, "subscription_id");
      if (this.directorySubscriptions.has(id)) {
        if (method === "events/ack") return { acknowledged: true };
        this.directorySubscriptions.delete(id);
        return { removed: true };
      }
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
        // A client holding a cached transcript attaches with
        // `includeSnapshot: false` and replays the gap through its event
        // subscription; the reply then carries only the light state instead of
        // the transcript page.
        if (params.includeSnapshot === false) {
          return { ...result, session: await this.describe(session), state: await this.state(session) };
        }
        return { ...result, session: await this.describe(session), snapshot: await this.snapshot(session) };
      }
      case "session/snapshot": return { snapshot: await this.snapshot(session) };
      case "session/state": return { state: await this.state(session) };
      case "session/history": {
        const page = await agent.history(this.principal, { sessionId, ...(params.beforeItemId ? { beforeItemId: string(params.beforeItemId, "before_item_id") } : {}), limit: integer(params.limit ?? 50, "limit", 200) || 1, contentLimit: MOBILE_ITEM_CONTENT_LIMIT });
        if (page.syncRevision === undefined) throw new RacpError("HOST_DISCONNECTED", "history_sync_revision_missing");
        const fitted = fitMobileHistory(page.items);
        return { ...page, items: fitted.items, hasMore: page.hasMore || fitted.omitted, syncRevision: page.syncRevision } satisfies MobileSessionHistoryPage;
      }
      case "session/changes": return this.changes(sessionId, params);
      case "session/item": return this.itemContent(sessionId, params);
      case "message/status": {
        const messageId = string(params.messageId, "message_id");
        const state = await agent.sessionState(sessionId);
        if (state.activeTurn?.idempotencyKey === messageId || this.deps.images.states().some((job) => job.sessionId === sessionId && job.jobId === messageId)) return { status: "running" };
        if (state.queuedTurns.some((turn) => turn.idempotencyKey === messageId)) return { status: "queued" };
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
        const state = await agent.sessionState(sessionId);
        if (!state.activeTurn) return { requested: false };
        return method === "turn/interrupt" ? agent.interruptTurn(this.principal, state.activeTurn.id) : agent.stopTurn(this.principal, state.activeTurn.id);
      }
      case "turn/cancel": {
        const turnId = string(params.turnId, "turn_id");
        if (agent.getTurn(turnId).sessionId !== sessionId) throw new RacpError("FORBIDDEN", "turn_not_in_session");
        return agent.cancelTurn(this.principal, turnId);
      }
      case "turn/prioritize": {
        // "Send now": the promoted queued message is steered into the running
        // turn when the runtime supports it (ADR 0265), exactly like desktop.
        const turnId = string(params.turnId, "turn_id");
        if (agent.getTurn(turnId).sessionId !== sessionId) throw new RacpError("FORBIDDEN", "turn_not_in_session");
        return { turn: await agent.prioritizeTurn(this.principal, turnId) };
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
        const state = await agent.sessionState(sessionId);
        if (!state.pendingInputs.some((input) => input.id === inputId)) throw new RacpError("CONFLICT", "input_already_resolved");
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
      capabilities: { eventReplay: true, snapshot: true, approvals: true, inputRequests: true, attachments: true, serverRequests: false, turnQueue: true, hostEvents: false, history: true, remoteHostProfile: false, toolRelay: false, terminal: false, notifications: false, sessionState: true, itemContent: true, bindings: ["RACP-WS"] } };
  }
  private async require(sessionId: string) {
    if (this.closed) throw new RacpError("HOST_DISCONNECTED", "connection_closed");
    return this.deps.scope.require(sessionId, this.deps.grants());
  }
  private async directory(params: Record<string, unknown>): Promise<MobileDirectoryPage> {
    const grants = this.deps.grants();
    const grantIds = grants.map((grant) => grant.id).sort().join("\u0000");
    const [groups, records] = await Promise.all([this.deps.scope.groups(), this.deps.scope.sessions(grants)]);
    const accountWide = grants.some((grant) => grant.scope.kind === "account");
    const projectIds = new Set(grants.filter((grant) => grant.scope.kind === "project").map((grant) => grant.scope.id));
    const visibleGroups = groups.filter((group) => accountWide || projectIds.has(group.id));
    const projects: MobileProject[] = visibleGroups.map((group) => ({ id: group.id, label: group.name, path: group.primaryPath, archived: false }));
    const sorted = [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const limit = integer(params.limit ?? 50, "limit", 100) || 1;
    const cursor = params.cursor === undefined ? undefined : string(params.cursor, "cursor");
    const start = cursor ? sorted.findIndex((item) => directoryCursor(item) === cursor) + 1 : 0;
    if (cursor && start === 0) throw new RacpError("INVALID_ARGUMENT", "invalid_directory_cursor");
    const page = sorted.slice(start, start + limit);
    const sessions = await Promise.all(page.map(async (record) => {
      const group = groupForSession(record.projectPath, visibleGroups);
      const description = await this.describe(record);
      return group ? { ...description, projectId: group.id } : { ...description, projectId: undefined };
    }));
    if (grantIds !== this.deps.grants().map((grant) => grant.id).sort().join("\u0000")) throw new RacpError("FORBIDDEN", "share_changed");
    return { desktopDeviceId: this.deps.desktopDeviceId, projects, sessions,
      ...(start + limit < sorted.length ? { nextCursor: directoryCursor(page.at(-1)!) } : {}), generatedAt: new Date().toISOString() };
  }
  private async changes(sessionId: string, params: Record<string, unknown>): Promise<MobileSessionChangesPage> {
    const afterRevision = integer(params.afterRevision ?? 0, "after_revision");
    const limit = integer(params.limit ?? 50, "limit", 50) || 1;
    type HostChange = { revision: number; kind: "upsert"; messageId: string; sequence: number; message: UiMessage } | { revision: number; kind: "delete"; messageId: string };
    type HostPage = { sessionId: string; afterRevision: number; revision: number; hasMore: boolean; changes: HostChange[] };
    const page = await this.deps.host().call<HostPage>("session.changes", { sessionId, afterRevision, limit, contentLimit: MOBILE_ITEM_CONTENT_LIMIT });
    const changes = page.changes.map((change) => change.kind === "upsert"
      ? { revision: change.revision, kind: change.kind, messageId: change.messageId, sequence: change.sequence, item: fitMobileItem(toRacpItem(change.message)) }
      : change);
    let count = 0;
    let bytes = 0;
    for (const change of changes) {
      const size = Buffer.byteLength(JSON.stringify(change));
      if (bytes + size > MOBILE_TRANSCRIPT_PAGE_BYTES) break;
      bytes += size;
      count += 1;
    }
    if (changes.length && count === 0) throw new RacpError("PAYLOAD_TOO_LARGE", "session_change_too_large");
    return { ...page, changes: changes.slice(0, count),
      ...(count < changes.length ? { revision: changes[count - 1].revision, hasMore: true } : {}) };
  }
  private async syncRevision(sessionId: string): Promise<number> {
    const result = await this.deps.host().call<{ syncRevision: number }>("session.syncRevision", { sessionId });
    return result.syncRevision;
  }
  private async configure(record: SessionSummary, params: Record<string, unknown>): Promise<MobileSession> {
    if (!canPrompt(record)) throw new RacpError("FORBIDDEN", "session_read_only");
    const settings = await this.deps.host().call<AppSettings>("settings.get");
    const previousRecord = record;
    const current = await this.describe(record, settings);
    const input = parseConfiguration(params);
    const requestedMode = input.mode ?? current.taskMode;
    const currentMode = current.taskMode;
    const state = await this.deps.agent().sessionState(record.id);
    const imageBusy = this.deps.images.states().some((job) => job.sessionId === record.id && job.status === "running");
    const busy = Boolean(state.activeTurn || state.queuedTurns.length || imageBusy);
    const approvalPending = state.session.planningState === "awaiting_approval" || state.pendingApprovals.length > 0;
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
      await configureSession(this.deps.host(), record.id, { mode: "agent" });
      try {
        await this.deps.images.configure(record.id, {
          active: true,
          providerId: choice.providerId,
          modelId: choice.modelId,
          options,
        });
      } catch (error) {
        await rethrowAfterRollback(error, this.deps.host, previousRecord);
      }
    } else {
      const result = await configureSession(this.deps.host(), record.id, {
        mode: requestedMode,
        ...(input.ultra === undefined ? {} : { ultra: input.ultra }),
        ...(input.fast === undefined ? {} : { fast: input.fast }),
        ...(providerId !== undefined ? { providerId } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(effectiveThinking !== undefined ? { thinkingLevel: effectiveThinking } : {}),
      });
      if (result.session) record = { ...record, ...result.session };
      if (currentMode === "image") {
        try {
          await this.deps.images.configure(record.id, { active: false, providerId: current.imageConfig?.providerId, modelId: current.imageConfig?.modelId, options: current.imageConfig?.options ?? { count: 1 } });
        } catch (error) {
          await rethrowAfterRollback(error, this.deps.host, previousRecord);
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
      ...(described.activeTurnId ? { current: currentTurnConfiguration(this.deps.host(), record.id) }
        : image && busy ? { current: next } : {}),
      next,
      chat,
      ...(config ? { image: { mode: "image", ...(config.providerId ? { providerId: config.providerId } : {}), ...(config.modelId ? { modelId: config.modelId } : {}), imageConfig: config } } : {}),
      canConfigure: canPrompt(record),
      pendingTurn: busy,
      ...(!canPrompt(record) ? { blockedReason: "read_only" as const } : busy ? { blockedReason: "running" as const } : approvalPending ? { blockedReason: "approval_pending" as const } : {}),
    };
    return { ...described, providerId, modelId, thinkingLevel: record.thinkingLevel, ultra: !image && record.ultra === true, fast: !image && record.fast === true,
      groupName, taskMode, ...(config ? { imageConfig: config } : {}), configuration,
      capabilities: { canPrompt: canPrompt(record), canStop: record.capabilities?.canStop ?? record.source !== "pi-native" } };
  }
  private async snapshot(record: SessionSummary): Promise<MobileSessionSnapshot> {
    // The per-field cap keeps one oversized message from bursting the relay
    // frame limit; full content stays reachable per item via `session/item`.
    const [context, snapshot, session] = await Promise.all([
      this.sessionContext(record.id),
      this.deps.agent().snapshot(record.id, undefined, { contentLimit: MOBILE_ITEM_CONTENT_LIMIT }),
      this.describe(record),
    ]);
    if (snapshot.syncRevision === undefined) throw new RacpError("HOST_DISCONNECTED", "snapshot_sync_revision_missing");
    const fitted = fitMobileHistory(snapshot.items);
    return { ...snapshot, items: fitted.items, hasMoreHistory: snapshot.hasMoreHistory || fitted.omitted,
      session, ...context, syncRevision: snapshot.syncRevision };
  }
  /** The snapshot minus its transcript page: live state for cached clients. */
  private async state(record: SessionSummary): Promise<MobileSessionState> {
    const [context, state, session] = await Promise.all([
      this.sessionContext(record.id),
      this.deps.agent().sessionState(record.id),
      this.describe(record),
    ]);
    return { ...state, session, ...context, syncRevision: await this.syncRevision(record.id) };
  }
  /** Session-scoped extras both projections carry: plans, image jobs, queue previews, compaction marks. */
  private async sessionContext(sessionId: string) {
    const [{ plans }, detail] = await Promise.all([
      this.deps.host().call<{ plans: PlanProposal[] }>("plans.pending", { sessionId }),
      this.deps.host().call<{ session?: SessionDetail }>("session.get", { id: sessionId, messageLimit: 1, contentLimit: 1 }),
    ]);
    return {
      plans,
      imageJobs: this.deps.images.states().filter((job) => job.sessionId === sessionId),
      queuedPrompts: this.deps.agent().queueEntries(sessionId).map((entry) => ({ turnId: entry.turn.id, content: entry.content.slice(0, 280) })),
      compactions: (detail.session?.compactions ?? []).map((record) => ({ id: record.id, throughMessageId: record.throughMessageId })),
    };
  }
  /**
   * Chunked read of one item's complete JSON, for a card the snapshot capped.
   * The payload is the UTF-8 JSON of the uncapped `UiMessage`, sliced into
   * relay-safe chunks like `attachment/read`.
   */
  private async itemContent(sessionId: string, params: Record<string, unknown>) {
    const itemId = string(params.itemId, "item_id");
    const result = await this.deps.host().call<{ session?: SessionDetail }>("session.get", { id: sessionId, messageAround: itemId, messageLimit: 1 });
    const message = result.session?.messages.find((candidate) => candidate.id === itemId);
    if (!message) throw new RacpError("NOT_FOUND", "item_not_found");
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const offset = integer(params.offset ?? 0, "offset", payload.length);
    const chunk = payload.subarray(offset, Math.min(offset + MOBILE_ATTACHMENT_CHUNK_BYTES, payload.length));
    return { data: chunk.toString("base64"), offset, nextOffset: offset + chunk.length, size: payload.length, eof: offset + chunk.length === payload.length };
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
      return this.deps.images.start({ sessionId: session.id, jobId, messageId, providerId: config.providerId, modelId: config.modelId, prompt: text, references: attachments, options: config.options });
    }
    const result = await this.deps.agent().startTurn(this.principal, { sessionId: session.id, admission: "queue", idempotencyKey: messageId,
      input: { text, userMessageId: messageId, attachments }, context: { requestId: messageId } });
    return result;
  }
  private deliver(event: RacpEventEnvelope) {
    if (this.closed) return;
    if (++this.pendingEvents > 1_000) { this.deps.close("resync_required"); return; }
    this.delivery = this.delivery.then(async () => {
      if (!event.sessionId || this.closed) return;
      try {
        await this.require(event.sessionId);
      }
      catch { this.deps.close("share_revoked"); return; }
      if (!this.closed) {
        this.deps.send(encodeFrame({ jsonrpc: "2.0", method: RACP_EVENT_NOTIFICATION, params: event }));
      }
    }).catch(() => this.deps.close("delivery_failed")).finally(() => { this.pendingEvents -= 1; });
  }
  private async deliverActivity(sessionId: string, payload: unknown) {
    try {
      await this.require(sessionId);
      const state = await this.deps.agent().sessionState(sessionId);
      this.deliver({ eventId: randomUUID(), scope: "session", sessionId, epoch: state.cursor.epoch, afterSequence: state.cursor.sequence,
        revision: state.revision, kind: "turn.activity", occurredAt: new Date().toISOString(), payload });
    } catch { this.deps.close("share_revoked"); }
  }
}

function directoryCursor(session: SessionSummary): string {
  return Buffer.from(JSON.stringify([session.updatedAt, session.id]), "utf8").toString("base64url");
}

function groupForSession(path: string | undefined, groups: ProjectGroupRecord[]): ProjectGroupRecord | undefined {
  if (!path) return undefined;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return groups.find((group) => group.roots.some((root) => {
    const rootPath = root.path.replace(/\\/g, "/").replace(/\/+$/, "");
    return (process.platform === "win32" ? rootPath.toLowerCase() : rootPath) === key;
  }));
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
  await configureSession(host(), record.id, {
    ultra: record.ultra === true, fast: record.fast === true,
    mode: record.mode,
    ...(record.providerId !== undefined ? { providerId: record.providerId } : {}),
    ...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
    ...(record.thinkingLevel !== undefined ? { thinkingLevel: record.thinkingLevel } : {}),
  });
}

function parseConfiguration(params: Record<string, unknown>): MobileSessionConfigureInput {
  if (params.ultra !== undefined && typeof params.ultra !== "boolean") throw new RacpError("INVALID_ARGUMENT", "invalid_ultra");
  if (params.fast !== undefined && typeof params.fast !== "boolean") throw new RacpError("INVALID_ARGUMENT", "invalid_fast");
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
    ...(typeof params.ultra === "boolean" ? { ultra: params.ultra } : {}),
    ...(typeof params.fast === "boolean" ? { fast: params.fast } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(imageConfig ? { imageConfig } : {}),
  };
}
