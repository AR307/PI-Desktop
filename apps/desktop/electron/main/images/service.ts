import { randomUUID } from "node:crypto";
import {
  IPC, IMAGE_GENERATION_TIMEOUT_MS, validateImageOptions,
  type AgentEventEnvelope, type AppSettings, type ImageGenerationRequest, type ImageGenerationResult,
  type ImageGenerationState, type ImageModelInfo, type ImageOutput, type ImageSessionConfig,
  type ProviderPublic, type SessionDetail, type UiMessage,
} from "@pi-desktop/shared";
import type { AgentSidecar } from "../agent-sidecar";
import type { HostProcess } from "../host-process";
import type { MirrorCodingAccount } from "../mirrorcoding/account";
import type { MirrorCodingRelay } from "../mirrorcoding/relay";
import { preparePromptAttachments } from "../prompt-attachments";
import { persistGeneratedImage } from "./attachments";

export type ImageServiceDependencies = {
  dataDir: string;
  getHost(): HostProcess | null;
  getSidecar(): AgentSidecar | null;
  getActiveTurns(): Map<string, string>;
  acquireSessionOperation(sessionId: string): Promise<() => void>;
  emit(envelope: AgentEventEnvelope): void;
  send(channel: string, value: unknown): void;
};
type Job = { state: ImageGenerationState; controller: AbortController; sidecar?: AgentSidecar; direct: boolean };

export class ImageService {
  private jobs = new Map<string, Job>();
  private configWrite: Promise<unknown> = Promise.resolve();
  constructor(private deps: ImageServiceDependencies, private account: MirrorCodingAccount, private relay: MirrorCodingRelay) {}
  private host() { const host = this.deps.getHost(); if (!host) throw new Error("host_unavailable"); return host; }
  states() { return [...this.jobs.values()].filter((job) => job.direct).map((job) => job.state); }
  hasJobs() { return this.jobs.size > 0; }
  abort(jobId: string) { const job = this.jobs.get(jobId); job?.controller.abort(); return !!job; }
  abortSession(sessionId: string) {
    let direct = false;
    for (const [id, job] of this.jobs) if (job.state.sessionId === sessionId) { this.abort(id); direct ||= job.direct; }
    return direct;
  }
  dispose() { for (const id of this.jobs.keys()) this.abort(id); }
  private publish(job: Job, status: ImageGenerationState["status"], error?: string) {
    job.state = { ...job.state, status, ...(error ? { error } : {}) };
    if (job.direct) this.deps.send(IPC.event.imageState, job.state);
  }
  private emitMessage(sessionId: string, message: UiMessage, turnId?: string) {
    for (const type of ["message_start", "message_end"] as const) this.deps.emit({ sessionId, turnId, ts: Date.now(), event: { type, message } });
  }
  async models(refresh = false): Promise<ImageModelInfo[]> {
    await this.account.initialize();
    if (refresh) await this.account.refreshCatalog();
    const { providers } = await this.host().call<{ providers: ProviderPublic[] }>("providers.list");
    const accountId = this.account.snapshot().account?.id;
    return providers.filter((p) => p.enabled && p.mirrorCoding?.accountId === accountId).flatMap((p) =>
      Object.entries(p.mirrorCoding?.imageModels ?? {}).map(([modelId, capability]) => ({
        providerId: p.id, modelId, displayName: modelId, capability, groupName: p.mirrorCoding!.groupName,
        description: p.mirrorCoding!.description, ratio: p.mirrorCoding!.ratio, dynamicBilling: p.mirrorCoding!.dynamicBilling,
      })));
  }
  configure(key: string, input: ImageSessionConfig): Promise<ImageSessionConfig> {
    const write = this.configWrite.then(async () => {
      if (!key || typeof input.active !== "boolean" || !input.options || typeof input.options !== "object") throw new Error("invalid_image_request");
      let options = input.options;
      if (input.providerId || input.modelId) {
        const model = (await this.models()).find((m) => m.providerId === input.providerId && m.modelId === input.modelId);
        if (model) options = validateImageOptions(model.capability, options);
      }
      const config = { active: input.active, providerId: input.providerId, modelId: input.modelId, options };
      const settings = await this.host().call<AppSettings>("settings.get");
      await this.host().call("settings.set", { imageSessions: { ...settings.imageSessions, [key]: config } });
      return config;
    });
    this.configWrite = write.catch(() => undefined);
    return write;
  }

  async generate(request: ImageGenerationRequest, direct = true): Promise<{ jobId: string; result: ImageGenerationResult }> {
    const jobId = request.jobId || randomUUID();
    if (this.jobs.has(jobId)) throw new Error("image_job_exists");
    const releaseOperation = direct ? await this.deps.acquireSessionOperation(request.sessionId) : undefined;
    const turns = this.deps.getActiveTurns();
    if (direct && turns.has(request.sessionId)) { releaseOperation?.(); throw new Error("session_busy"); }
    const job: Job = { state: { jobId, sessionId: request.sessionId, status: "running" }, controller: new AbortController(), direct };
    this.jobs.set(jobId, job);
    if (direct) turns.set(request.sessionId, jobId);
    releaseOperation?.();
    this.publish(job, "running");
    const timer = setTimeout(() => job.controller.abort(new Error("image_timeout")), IMAGE_GENERATION_TIMEOUT_MS);
    const cancel = () => { void job.sidecar?.call("image.abort", { jobId }).catch(() => undefined); };
    job.controller.signal.addEventListener("abort", cancel);
    let turnId: string | undefined;
    let releaseBinding: (() => void) | undefined;
    let result: ImageGenerationResult | undefined;
    let saved = false;
    const assistantId = randomUUID();
    const saveAssistant = async (status: UiMessage["status"]) => {
      if (!direct || !turnId || !result) return;
      const message: UiMessage = { id: assistantId, role: "assistant", status, createdAt: new Date().toISOString(),
        content: result.error ? "" : `Generated ${result.images.length} image(s) using ${result.model.modelId} / ${result.model.groupName}.`,
        providerId: request.providerId, modelId: request.modelId, imageGeneration: result };
      await this.host().call("session.appendMessage", { sessionId: request.sessionId, message, turnId });
      this.emitMessage(request.sessionId, message, turnId);
      saved = true;
    };
    try {
      const model = (await this.models()).find((m) => m.providerId === request.providerId && m.modelId === request.modelId);
      if (!model) throw new Error("model_or_group_unavailable");
      const { provider } = await this.host().call<{ provider: ProviderPublic }>("providers.get", { id: request.providerId });
      const { session } = await this.host().call<{ session: SessionDetail }>("session.get", { id: request.sessionId, messageLimit: 1 });
      if (!session) throw new Error("session_not_found");
      const prepared = await preparePromptAttachments(this.deps.dataDir, request.sessionId, session.projectPath, request.references ?? [], true);
      if (prepared.some((ref) => ref.message.kind !== "image" || !ref.inlineData)) throw new Error("images_reference_too_large");
      const options = validateImageOptions(model.capability, request.options, prepared.length);
      result = { kind: "image-generation", model, prompt: request.prompt, options, images: [] };
      job.controller.signal.throwIfAborted();
      if (direct) {
        const turn = await this.host().call<{ turnId: string }>("session.beginTurn", { sessionId: request.sessionId, providerId: request.providerId, modelId: request.modelId });
        turnId = turn.turnId;
        turns.set(request.sessionId, turnId);
        const message: UiMessage = { id: randomUUID(), role: "user", content: request.prompt, createdAt: new Date().toISOString(), status: "complete", attachments: prepared.map((ref) => ref.message) };
        await this.host().call("session.appendMessage", { sessionId: request.sessionId, message, turnId });
        this.emitMessage(request.sessionId, message, turnId);
      }
      const binding = await this.relay.bindImage(request.providerId, provider.mirrorCoding!, request.modelId, request.sessionId);
      releaseBinding = binding.release;
      job.controller.signal.throwIfAborted();
      job.sidecar = this.deps.getSidecar() ?? undefined;
      if (!job.sidecar) throw new Error("sidecar_unavailable");
      const output = await job.sidecar.call<{ outputs: ImageOutput[]; text?: string }>("image.generate", {
        jobId, prompt: request.prompt, options,
        binding: { model, baseUrl: binding.baseUrl, headers: binding.headers, references: prepared.map((ref) => ({ data: ref.inlineData!, mimeType: ref.message.mimeType || "image/png" })) },
      });
      result.images = await Promise.all(output.outputs.map((image, i) => persistGeneratedImage(this.deps.dataDir, image, `${jobId}-${i + 1}`, job.controller.signal)));
      result.text = output.text;
      job.controller.signal.throwIfAborted();
      await saveAssistant("complete");
      if (turnId) await this.host().call("session.endTurn", { turnId, status: "completed" });
      this.publish(job, "complete");
      return { jobId, result };
    } catch (error) {
      const code = job.controller.signal.aborted
        ? job.controller.signal.reason instanceof Error && job.controller.signal.reason.message === "image_timeout" ? "image_timeout" : "image_aborted"
        : error instanceof Error ? error.message : "image_generation_failed";
      this.publish(job, job.controller.signal.aborted ? "aborted" : "error", code);
      if (result && !saved) { result.error = code; await saveAssistant(job.controller.signal.aborted ? "aborted" : "error"); }
      if (turnId) await this.host().call("session.endTurn", { turnId, status: job.controller.signal.aborted ? "aborted" : "error", errorCode: code });
      throw new Error(code);
    } finally {
      clearTimeout(timer);
      job.controller.signal.removeEventListener("abort", cancel);
      releaseBinding?.();
      this.jobs.delete(jobId);
      if (direct && (turns.get(request.sessionId) === jobId || turns.get(request.sessionId) === turnId)) turns.delete(request.sessionId);
    }
  }

  async retryDownload(sessionId: string, messageId: string, imageId: string): Promise<UiMessage> {
    const { session } = await this.host().call<{ session: SessionDetail }>("session.get", { id: sessionId });
    const message = session?.messages.find((m) => m.id === messageId);
    const result = message?.imageGeneration ?? imageResult(message?.toolResult);
    const image = result?.images.find((entry) => entry.id === imageId);
    if (!message || !image?.downloadUrl) throw new Error("image_download_unavailable");
    const replacement = await persistGeneratedImage(this.deps.dataDir, { url: image.downloadUrl }, image.id, AbortSignal.timeout(60_000));
    Object.assign(image, replacement);
    if (replacement.attachment) { delete image.downloadUrl; delete image.error; }
    await this.host().call("session.appendMessage", { sessionId, message });
    this.emitMessage(sessionId, message);
    return message;
  }
}

function imageResult(value: unknown): ImageGenerationResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { kind?: string; details?: unknown; content?: unknown };
  if (row.kind === "image-generation") return value as ImageGenerationResult;
  return imageResult(row.details) ?? imageResult(row.content);
}
