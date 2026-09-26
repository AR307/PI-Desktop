import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Download, ImagePlus, FileText, ChevronDown, LoaderCircle, Scissors, UnfoldVertical } from "lucide-react";
import type { ImageGenerationResult, MessageAttachment, UiMessage } from "@pi-desktop/shared";
import type { MobileController } from "../state/controller";
import {
  buildDiffLines,
  extractToolDiff,
  isDisplayTruncated,
  messageHasTruncatedContent,
  toolPayloadFull,
  toolPayloadPreview,
} from "../state/transcript-view";
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

/** "Show full content" for a field host-core capped for display. */
function LoadFullButton({ controller, messageId }: { controller: MobileController; messageId: string }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [loading, setLoading] = useState(false);
  return <button className="load-full" disabled={loading} onClick={() => void controller.action(async () => {
    setLoading(true);
    try { await controller.itemContent(messageId); } finally { setLoading(false); }
  })}>{loading ? <LoaderCircle size={14} className="spin"/> : <UnfoldVertical size={14}/>}{t("loadFull")}</button>;
}

function DiffBlock({ before, after, path }: { before: string; after: string; path?: string }) {
  const lines = buildDiffLines(before, after);
  return <div className="tool-diff">
    {path && <div className="tool-diff-path">{path}</div>}
    <pre>{lines.map((line, index) => <span key={index} className={`diff-line diff-${line.kind}`}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}{line.text}{"\n"}</span>)}</pre>
  </div>;
}

/** Tool payload with a cheap collapsed preview and full text only on demand. */
function ToolPayload({ label, value }: { label: string; value: unknown }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [expanded, setExpanded] = useState(false);
  const preview = toolPayloadPreview(value);
  return <>
    <h4>{label}</h4>
    <pre>{expanded ? toolPayloadFull(value) : preview.text}</pre>
    {preview.truncated && !expanded && <button className="load-full" onClick={() => setExpanded(true)}><UnfoldVertical size={14}/>{t("showMore")}</button>}
  </>;
}

function ToolCard({ message, controller }: { message: UiMessage; controller: MobileController }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const running = message.toolStatus === "running";
  const [open, setOpen] = useState(running);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  const diff = extractToolDiff(message.toolName, message.toolArgs);
  return <details className="tool-card" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary><span>{running ? <LoaderCircle size={15} className="spin"/> : <ChevronDown size={15}/>} {message.toolName ?? t("tool")}</span><small>{message.toolStatus}</small></summary>
    {open && <>
      {diff ? <DiffBlock before={diff.before} after={diff.after} path={diff.path}/> : message.toolArgs !== undefined && <ToolPayload label={t("input")} value={message.toolArgs}/>}
      {message.toolResult !== undefined && <ToolPayload label={t("result")} value={message.toolResult}/>}
      {messageHasTruncatedContent(message) && <LoadFullButton controller={controller} messageId={message.id}/>}
    </>}
  </details>;
}

function ThinkingCard({ text }: { text: string }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [open, setOpen] = useState(false);
  return <details className="thinking" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary>{t("thinking")}</summary>
    {open && <Markdown>{text}</Markdown>}
  </details>;
}

export const Message = memo(function Message({ message, controller, reference }: { message: UiMessage; controller: MobileController; reference(file: PickedAttachment): void }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const generated = message.imageGeneration ?? imageResult(message.toolResult);
  const truncatedBody = isDisplayTruncated(message.content) || isDisplayTruncated(message.thinking);
  return <article className={`message message-${message.role}`} data-message-id={message.id}>
    {message.role === "tool" ? <ToolCard message={message} controller={controller}/> : <>
      <div className="message-label">{message.agentName ?? t(message.role === "user" ? "you" : "assistant")}{message.status === "streaming" && <span className="streaming-caret" aria-hidden="true"/>}</div>
      {message.thinking && <ThinkingCard text={message.thinking}/>}
      {message.content && <Markdown>{message.content}</Markdown>}
      {truncatedBody && <LoadFullButton controller={controller} messageId={message.id}/>}
    </>}
    {message.attachments?.map((attachment) => <AttachmentCard key={attachment.ref} controller={controller} messageId={message.id} id={attachment.ref} attachment={attachment} reference={reference}/>)}
    {generated && <section className="image-result"><p className="muted">{t("generatedWith")} {generated.model.displayName} · {generated.model.groupName}</p>{generated.images.map((image) => image.attachment ? <AttachmentCard key={image.id} controller={controller} messageId={message.id} id={image.id} attachment={image.attachment} reference={reference}/> : <div key={image.id} className="image-pending"><p>{image.error}</p><button onClick={() => void controller.retryImage(message.id, image.id)}>{t("retryDownload")}</button></div>)}</section>}
    {(message.error || generated?.error) && <p className="error-text">{message.error?.message ?? generated?.error}</p>}
  </article>;
});

/** Collapsible run of messages one delegate produced (`parentToolCallId`). */
export const DelegationCard = memo(function DelegationCard({ id, agentName, running, messages, controller, reference }: {
  id: string; agentName?: string; running: boolean; messages: UiMessage[]; controller: MobileController; reference(file: PickedAttachment): void;
}) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [open, setOpen] = useState(false);
  return <details className="delegation-card" data-delegation-id={id} open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary>
      <span className="delegation-title">{running ? <LoaderCircle size={15} className="spin"/> : <Bot size={15}/>} {agentName ?? t("subagent")}</span>
      <small>{t(running ? "working" : "ready")} · {messages.length}</small>
    </summary>
    {open && <div className="delegation-body">{messages.map((message) => <Message key={message.id} message={message} controller={controller} reference={reference}/>)}</div>}
  </details>;
});

/** Divider where a context compaction cut the transcript. */
export function CompactionDivider() {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  return <div className="compaction-divider" role="separator"><Scissors size={13}/><span>{t("compacted")}</span></div>;
}
