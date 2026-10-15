import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { GeneratedImage, ImageGenerationResult, UiMessage } from "@pi-desktop/shared";
import { useReferencedImageDataUrl } from "../../lib/use-referenced-image-data-url";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { useGeneratedImage } from "./useImageReference";

export function imageResultFromMessage(message: UiMessage): ImageGenerationResult | undefined {
  const find = (value: unknown): ImageGenerationResult | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const row = value as { kind?: string; images?: unknown; content?: unknown; details?: unknown };
    if (row.kind === "image-generation" && Array.isArray(row.images)) return value as ImageGenerationResult;
    return find(row.details) ?? find(row.content);
  };
  return message.imageGeneration ?? find(message.toolResult);
}

export function ImageResult({ message }: { message: UiMessage }) {
  const { t } = useTranslation();
  const result = imageResultFromMessage(message);
  const sessionId = useAppStore((state) => state.activeSessionId);
  if (!result || !sessionId) return null;
  return <section className="image-result" aria-label={t("images.result")}>
    <div className="image-result-model">{result.model.displayName} · {result.model.groupName}
      <span>{result.model.dynamicBilling ? t("mirrorCoding.dynamic") : `${result.model.ratio}×`}</span>
    </div>
    {result.error ? <p role="alert">{t(`images.${result.error}`, { defaultValue: t("images.image_generation_failed") })}</p> : null}
    <div className="image-result-grid">{result.images.map((image) => <ImageCard key={image.id} image={image} sessionId={sessionId} messageId={message.id} />)}</div>
  </section>;
}

function ImageCard({ image, sessionId, messageId }: { image: GeneratedImage; sessionId: string; messageId: string }) {
  const { t } = useTranslation();
  const dataUrl = useReferencedImageDataUrl(image.attachment?.ref, image.attachment?.mimeType);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const retry = async () => {
    setBusy(true);
    try { await api.retryImageDownload(sessionId, messageId, image.id); }
    catch { useAppStore.getState().showToast(t("images.image_download_failed"), { variant: "error" }); }
    finally { setBusy(false); }
  };
  return <div className="image-result-card">
    {dataUrl ? <button type="button" className="image-result-thumbnail" aria-label={t("images.preview")} onClick={() => setOpen(true)}>
      <img src={dataUrl} alt={t("images.result")} />
    </button> : <p role="status">{t(image.error ? "images.image_download_failed" : "common.loading")}</p>}
    <div className="image-result-actions">
      {dataUrl ? <a href={dataUrl} download={image.attachment?.name}>{t("common.save")}</a> : null}
      {image.attachment ? <button type="button" onClick={() => useGeneratedImage(sessionId, image.attachment!)}>{t("images.useReference")}</button> : null}
      {image.downloadUrl ? <button type="button" disabled={busy} onClick={() => void retry()}>{t("images.retryDownload")}</button> : null}
    </div>
    {open && dataUrl ? createPortal(<dialog ref={dialog} className="image-result-preview" aria-label={t("images.preview")} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button type="button" onClick={() => dialog.current?.close()}>{t("common.close")}</button>
      <img src={dataUrl} alt={t("images.result")} />
    </dialog>, document.body) : null}
  </div>;
}
