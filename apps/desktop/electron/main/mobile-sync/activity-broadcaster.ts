import type { ImageGenerationState, MobileAttention, MobileSession, RacpEventEnvelope, SessionDetail, UiMessage } from "@pi-desktop/shared";
import type { ImageService } from "../images/service";
import { boundedText, plainText, signalForEvent, signalForImage, type SessionSignal } from "./activity";
import { describeMobileSession, type SessionProjectionDependencies } from "./session-projection";

/** A connected phone that asked for session activity; it applies its own share scope. */
export type ActivityTarget = { activity(sessionId: string, session: MobileSession, attention?: MobileAttention): Promise<void> };

export type ActivityBroadcasterDependencies = SessionProjectionDependencies & {
  images: Pick<ImageService, "states" | "subscribe">;
  targets(): ActivityTarget[];
  log(message: string, error?: unknown): void;
  delayMs?: number;
};

/** Status bursts (start, tool approvals, end) collapse into one projection per session. */
const ACTIVITY_DELAY_MS = 250;

function completionPreview(messages: readonly UiMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && !message.parentToolCallId && message.content.trim()) return boundedText(plainText(message.content));
  }
  return undefined;
}

/**
 * Turns Agent Host and image events into refreshed directory rows with
 * attention for paired phones. Coalescing never drops attention: every
 * collected attention is delivered, in order, with the latest row.
 */
export class MobileActivityBroadcaster {
  private readonly pending = new Map<string, MobileAttention[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly imageStatus = new Map<string, ImageGenerationState["status"]>();
  private readonly stopImages: () => void;
  private disposed = false;
  constructor(private readonly deps: ActivityBroadcasterDependencies) {
    this.stopImages = deps.images.subscribe((state) => {
      const signal = signalForImage(state, this.imageStatus.get(state.jobId), new Date().toISOString());
      if (state.status === "running") this.imageStatus.set(state.jobId, state.status);
      else this.imageStatus.delete(state.jobId);
      if (signal) this.queue(signal);
    });
  }
  agentEvent(envelope: RacpEventEnvelope) {
    if (this.disposed) return;
    try {
      const agent = this.deps.agent();
      const signal = signalForEvent(envelope, {
        pending: (sessionId) => ({ approvals: agent.pendingApprovals(sessionId).length, inputs: agent.pendingInputRequests(sessionId).length }),
        turnError: (turnId) => { try { return agent.getTurn(turnId).error; } catch { return undefined; } },
      });
      if (signal) this.queue(signal);
    } catch (error) { this.deps.log("mobile activity mapping failed", error); }
  }
  private queue(signal: SessionSignal) {
    if (this.disposed) return;
    const attentions = this.pending.get(signal.sessionId) ?? [];
    if (signal.attention) attentions.push(signal.attention);
    this.pending.set(signal.sessionId, attentions);
    if (this.timers.has(signal.sessionId)) return;
    const timer = setTimeout(() => { void this.flush(signal.sessionId); }, this.deps.delayMs ?? ACTIVITY_DELAY_MS);
    timer.unref?.();
    this.timers.set(signal.sessionId, timer);
  }
  private async flush(sessionId: string) {
    this.timers.delete(sessionId);
    const attentions = this.pending.get(sessionId) ?? [];
    this.pending.delete(sessionId);
    const targets = this.deps.targets();
    if (this.disposed || targets.length === 0) return;
    try {
      const { session: detail } = await this.deps.host().call<{ session?: SessionDetail }>("session.get", { id: sessionId, messageLimit: 4, contentLimit: 600 });
      if (!detail || this.disposed) return;
      const session = await describeMobileSession(this.deps, detail);
      const preview = completionPreview(detail.messages);
      const delivered = attentions.map((attention) => attention.kind === "completed" && !attention.image && !attention.preview && preview
        ? { ...attention, preview } : attention);
      await Promise.all(targets.map(async (target) => {
        if (delivered.length === 0) await target.activity(sessionId, session);
        for (const attention of delivered) await target.activity(sessionId, session, attention);
      }));
    } catch (error) { this.deps.log("mobile activity projection failed", error); }
  }
  dispose() {
    this.disposed = true;
    this.stopImages();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.pending.clear(); this.imageStatus.clear();
  }
}
