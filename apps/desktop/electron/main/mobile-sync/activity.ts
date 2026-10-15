import { MOBILE_ATTENTION_TEXT_LIMIT, type ImageGenerationState, type MobileAttention, type RacpApprovalRequest, type RacpEventEnvelope, type RacpInputRequest } from "@pi-desktop/shared";

/** A session whose directory row changed, with the attention the user should see. */
export type SessionSignal = { sessionId: string; attention?: MobileAttention };

/** Live Agent Host facts the mapping needs to decide whether a turn end needs the user. */
export type ActivityLookups = {
  pending(sessionId: string): { approvals: number; inputs: number };
  turnError(turnId: string): { code?: string; message?: string } | undefined;
};

/** One line of display text: whitespace collapsed and bounded for the notification. */
export function boundedText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MOBILE_ATTENTION_TEXT_LIMIT ? `${text.slice(0, MOBILE_ATTENTION_TEXT_LIMIT - 1).trimEnd()}…` : text;
}

/**
 * Markdown reduced to readable notification text: fenced code, link targets,
 * block markers and paired emphasis go; identifiers such as snake_case stay.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|[^\w*])([*_])(\S(?:.*?\S)?)\2(?![\w*])/g, "$1$3");
}

function eventError(payload: unknown): { code?: string; message?: string } | undefined {
  const event = (payload as { event?: { type?: string; error?: { code?: unknown; message?: unknown } } } | undefined)?.event;
  if (event?.type !== "error" || !event.error) return undefined;
  return { ...(typeof event.error.code === "string" ? { code: event.error.code } : {}), ...(typeof event.error.message === "string" ? { message: event.error.message } : {}) };
}

/**
 * Map one published Host envelope to a directory refresh, attaching attention
 * when the user is needed: a pending approval or question, a finished or
 * failed top-level turn, or `resolved` once nothing is pending. A delegate's
 * settlement never ends its parent, and a turn that ends with a request still
 * pending keeps the request as the visible attention.
 */
export function signalForEvent(envelope: RacpEventEnvelope, lookups: ActivityLookups): SessionSignal | undefined {
  const sessionId = envelope.sessionId;
  if (!sessionId || envelope.scope !== "session") return undefined;
  const base = { ...(envelope.turnId ? { turnId: envelope.turnId } : {}), occurredAt: envelope.occurredAt };
  switch (envelope.kind) {
    case "approval.requested": {
      const request = envelope.payload as RacpApprovalRequest;
      const title = boundedText(request.title ?? request.question ?? request.summary);
      return { sessionId, attention: { id: `approval:${request.id}`, kind: "approval", requestId: request.id, requestKind: request.kind, ...base, ...(title ? { title } : {}) } };
    }
    case "input.requested": {
      const request = envelope.payload as RacpInputRequest;
      const title = boundedText(request.questions[0]?.question);
      return { sessionId, attention: { id: `input:${request.id}`, kind: "input", requestId: request.id, ...base, ...(title ? { title } : {}) } };
    }
    case "approval.resolved":
    case "input.resolved": {
      const pending = lookups.pending(sessionId);
      if (pending.approvals || pending.inputs) return { sessionId };
      return { sessionId, attention: { id: `resolved:${envelope.eventId}`, kind: "resolved", ...base } };
    }
    case "turn.completed":
    case "turn.failed": {
      if (envelope.parentToolCallId) return undefined;
      const pending = lookups.pending(sessionId);
      if (envelope.kind === "turn.completed" && (pending.approvals || pending.inputs)) return { sessionId };
      const failure = envelope.kind === "turn.failed" ? eventError(envelope.payload) ?? (envelope.turnId ? lookups.turnError(envelope.turnId) : undefined) : undefined;
      const preview = boundedText(failure?.message);
      return { sessionId, attention: {
        id: `turn:${envelope.turnId ?? envelope.eventId}:${envelope.kind === "turn.completed" ? "completed" : "failed"}`,
        kind: envelope.kind === "turn.completed" ? "completed" : "failed", ...base,
        ...(failure?.code ? { errorCode: failure.code } : {}), ...(preview ? { preview } : {}),
      } };
    }
    case "turn.queued":
    case "turn.started":
    case "turn.interrupted":
    case "turn.canceled":
    case "session.changed":
      return { sessionId };
    default:
      return undefined;
  }
}

/** Direct image generation runs outside the Agent Host; its outcomes are task outcomes too. */
export function signalForImage(state: ImageGenerationState, previous: ImageGenerationState["status"] | undefined, occurredAt: string): SessionSignal | undefined {
  if (state.status === previous) return undefined;
  if (state.status === "complete") return { sessionId: state.sessionId, attention: { id: `image:${state.jobId}:completed`, kind: "completed", image: true, occurredAt } };
  if (state.status === "error") {
    const preview = boundedText(state.error);
    return { sessionId: state.sessionId, attention: { id: `image:${state.jobId}:failed`, kind: "failed", image: true, occurredAt, ...(preview ? { preview } : {}) } };
  }
  return { sessionId: state.sessionId };
}
