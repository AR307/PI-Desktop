import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ImagePlus, FileText, ChevronDown, LoaderCircle } from "lucide-react";
import type { ImageGenerationResult, MessageAttachment, UiMessage } from "@pi-desktop/shared";
import type { MobileController } from "../state/controller";
import { saveAttachment, type PickedAttachment } from "../services/attachments";
import { Markdown } from "./Markdown";
import { useBackDismiss } from "./useBackDismiss";

function imageResult(value: unknown): ImageGenerationResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { kind?: string; images?: unknown; content?: unknown; details?: unknown };
  if (row.kind === "image-generation" && Array.isArray(row.images)) return value as ImageGenerationResult;
  return imageResult(row.details) ?? imageResult(row.content);
}

function AttachmentCard({ controller, messageId, id, attachment, reference }: { controller: MobileController; messageId: string; id: string; attachment: MessageAttachment; reference(file: PickedAttachment): void }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [value, setValue] = useState<{ blob: Blob; name: string; url: string }>();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useBackDismiss(preview, () => setPreview(false));
  useEffect(() => () => { if (value) URL.revokeObjectURL(value.url); }, [value]);
  const load = async () => {
    if (value) return value;
    setLoading(true);
    try { const result = await controller.attachment(messageId, id); if (!alive.current) throw new Error("Attachment view closed"); const next = { ...result, url: URL.createObjectURL(result.blob) }; setValue(next); return next; }
    finally { if (alive.current) setLoading(false); }
  };
  return <div className="attachment-card">
    {value && attachment.kind === "image" ? <button className="image-preview-button" aria-label={t("preview")} onClick={() => setPreview(true)}><img src={value.url} alt={attachment.name}/></button> : <button className="attachment-preview" disabled={loading} onClick={() => void controller.action(async () => { await load(); })}>{loading ? <LoaderCircle className="spin" size={20}/> : <FileText size={20}/>}<span>{attachment.name}</span></button>}
    <div className="attachment-actions"><button onClick={() => void controller.action(async () => { const file = await load(); await saveAttachment(file.blob, file.name); })}><Download size={15}/>{t("save")}</button>{attachment.kind === "image" && <button onClick={() => void controller.action(async () => { const file = await load(); reference({ id: crypto.randomUUID(), blob: file.blob, name: file.name, size: file.blob.size, mimeType: file.blob.type }); })}><ImagePlus size={15}/>{t("useReference")}</button>}</div>
    {preview && value && <div className="modal-scrim"><section className="dialog image-preview" role="dialog" aria-modal="true" aria-label={t("preview")}><button onClick={() => setPreview(false)}>{t("close")}</button><img src={value.url} alt={attachment.name}/></section></div>}
  </div>;
}

export function Message({ message, controller, reference }: { message: UiMessage; controller: MobileController; reference(file: PickedAttachment): void }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const generated = message.imageGeneration ?? imageResult(message.toolResult);
  return <article className={`message message-${message.role}`} data-message-id={message.id}>
    {message.role === "tool" ? <details className="tool-card" open={message.toolStatus === "running"}><summary><span>{message.toolStatus === "running" ? <LoaderCircle size={15} className="spin"/> : <ChevronDown size={15}/>} {message.toolName ?? t("tool")}</span><small>{message.toolStatus}</small></summary>{message.toolArgs !== undefined && <><h4>{t("input")}</h4><pre>{typeof message.toolArgs === "string" ? message.toolArgs : JSON.stringify(message.toolArgs, null, 2)}</pre></>}{message.toolResult !== undefined && <><h4>{t("result")}</h4><pre>{typeof message.toolResult === "string" ? message.toolResult : JSON.stringify(message.toolResult, null, 2)}</pre></>}</details> : <>
      <div className="message-label">{message.agentName ?? t(message.role === "user" ? "you" : "assistant")}{message.status === "streaming" && <span className="status-dot online"/>}</div>
      {message.thinking && <details className="thinking"><summary>{t("thinking")}</summary><Markdown>{message.thinking}</Markdown></details>}
      {message.content && <Markdown>{message.content}</Markdown>}
    </>}
    {message.attachments?.map((attachment) => <AttachmentCard key={attachment.ref} controller={controller} messageId={message.id} id={attachment.ref} attachment={attachment} reference={reference}/>)}
    {generated && <section className="image-result"><p className="muted">{t("generatedWith")} {generated.model.displayName} · {generated.model.groupName}</p>{generated.images.map((image) => image.attachment ? <AttachmentCard key={image.id} controller={controller} messageId={message.id} id={image.id} attachment={image.attachment} reference={reference}/> : <div key={image.id} className="image-pending"><p>{image.error}</p><button onClick={() => void controller.retryImage(message.id, image.id)}>{t("retryDownload")}</button></div>)}</section>}
    {(message.error || generated?.error) && <p className="error-text">{message.error?.message ?? generated?.error}</p>}
  </article>;
}
