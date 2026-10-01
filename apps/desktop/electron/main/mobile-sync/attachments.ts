import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { RacpError } from "@pi-desktop/agent-host";
import type { HostRpc } from "@pi-desktop/host-runtime";
import { MOBILE_ATTACHMENT_CHUNK_BYTES, RACP_DEFAULT_LIMITS, type AgentPromptAttachment, type ImageGenerationResult, type MessageAttachment, type MobileAttachmentRef, type SessionDetail } from "@pi-desktop/shared";
import { ensureAttachmentBlob, resolvePromptPath } from "../prompt-attachments";
import { integer, object, string } from "./validation";

type Upload = { sessionId: string; metadata: MobileAttachmentRef; chunks: Buffer[]; offset: number };
type Completed = { sessionId: string; attachment: AgentPromptAttachment; metadata: MobileAttachmentRef };

/** A peer can only reference its uploads or attachments already present in a shared message. */
export class MobileAttachments {
  private uploads = new Map<string, Upload>();
  private completed = new Map<string, Completed>();
  constructor(private dataDir: string, private host: () => HostRpc) {}
  dispose() { this.uploads.clear(); this.completed.clear(); }
  create(sessionId: string, params: Record<string, unknown>) {
    if (this.uploads.size >= 8) throw new RacpError("RATE_LIMITED", "too_many_uploads");
    const size = integer(params.size, "size", RACP_DEFAULT_LIMITS.maxAttachmentBytes);
    const kind = params.kind;
    if (kind !== "image" && kind !== "file") throw new RacpError("INVALID_ARGUMENT", "invalid_attachment_kind");
    const id = randomUUID();
    const name = string(params.name, "name").replace(/[\\/]/g, "_");
    const metadata: MobileAttachmentRef = { id, name, kind, size, ...(typeof params.mimeType === "string" ? { mimeType: params.mimeType } : {}) };
    this.uploads.set(id, { sessionId, metadata, chunks: [], offset: 0 });
    return { uploadId: id, chunkBytes: MOBILE_ATTACHMENT_CHUNK_BYTES };
  }
  write(sessionId: string, params: Record<string, unknown>) {
    const entry = this.upload(sessionId, params.uploadId);
    const offset = integer(params.offset, "offset");
    const data = string(params.data, "data", true);
    if (data.length > Math.ceil(MOBILE_ATTACHMENT_CHUNK_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new RacpError("INVALID_ARGUMENT", "invalid_chunk");
    const chunk = Buffer.from(data, "base64");
    if (offset !== entry.offset || entry.offset + chunk.length > entry.metadata.size) throw new RacpError("CONFLICT", "upload_offset_mismatch");
    entry.chunks.push(chunk); entry.offset += chunk.length;
    return { offset: entry.offset };
  }
  complete(sessionId: string, params: Record<string, unknown>) {
    const entry = this.upload(sessionId, params.uploadId);
    if (entry.offset !== entry.metadata.size) throw new RacpError("CONFLICT", "upload_incomplete");
    const ref = ensureAttachmentBlob(this.dataDir, Buffer.concat(entry.chunks));
    const attachment = { path: ref, name: entry.metadata.name, kind: entry.metadata.kind, mimeType: entry.metadata.mimeType, size: entry.metadata.size };
    this.completed.set(entry.metadata.id, { sessionId, attachment, metadata: entry.metadata });
    this.uploads.delete(entry.metadata.id);
    return { attachment: entry.metadata };
  }
  async resolve(sessionId: string, values: unknown): Promise<AgentPromptAttachment[]> {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > 32) throw new RacpError("INVALID_ARGUMENT", "invalid_attachments");
    return Promise.all(values.map(async (value) => {
      const ref = object(value);
      const id = string(ref.id, "attachment_id");
      const complete = this.completed.get(id);
      if (complete?.sessionId === sessionId) return complete.attachment;
      // Historical references must explicitly identify the owning message.
      const found = await this.find(sessionId, string(ref.messageId, "message_id"), id);
      return { path: found.path, name: found.attachment.name, kind: found.attachment.kind, mimeType: found.attachment.mimeType, size: found.attachment.size };
    }));
  }
  async read(sessionId: string, params: Record<string, unknown>) {
    const found = await this.find(sessionId, string(params.messageId, "message_id"), string(params.attachmentId, "attachment_id"));
    const file = await open(found.path, "r");
    try {
      const { size } = await file.stat();
      const offset = integer(params.offset ?? 0, "offset", size);
      const bytes = Buffer.alloc(Math.min(MOBILE_ATTACHMENT_CHUNK_BYTES, size - offset));
      const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
      return { data: bytes.subarray(0, bytesRead).toString("base64"), offset, nextOffset: offset + bytesRead, size, eof: offset + bytesRead === size, name: found.attachment.name, mimeType: found.attachment.mimeType || "application/octet-stream" };
    } finally { await file.close(); }
  }
  private upload(sessionId: string, id: unknown) {
    const entry = this.uploads.get(string(id, "upload_id"));
    if (!entry || entry.sessionId !== sessionId) throw new RacpError("NOT_FOUND", "upload_not_found");
    return entry;
  }
  private async find(sessionId: string, messageId: string, id: string) {
    const { session } = await this.host().call<{ session?: SessionDetail }>("session.get", { id: sessionId, messageAround: messageId, messageLimit: 1 });
    const message = session?.messages.find((candidate) => candidate.id === messageId);
    if (!session || !message) throw new RacpError("NOT_FOUND", "message_not_found");
    const images = (message.imageGeneration ?? imageResult(message.toolResult))?.images ?? [];
    const attachment = message.attachments?.find((item) => item.ref === id) ?? images.find((image) => image.id === id || image.attachment?.ref === id)?.attachment;
    if (!attachment) throw new RacpError("FORBIDDEN", "attachment_not_in_message");
    const path = resolvePromptPath(this.dataDir, sessionId, session.projectPath, attachment.ref);
    if (!path) throw new RacpError("NOT_FOUND", "attachment_unavailable");
    return { attachment, path: path.absolute };
  }
}

function imageResult(value: unknown): ImageGenerationResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as { kind?: string; details?: unknown; content?: unknown };
  if (item.kind === "image-generation") return value as ImageGenerationResult;
  return imageResult(item.details) ?? imageResult(item.content);
}
