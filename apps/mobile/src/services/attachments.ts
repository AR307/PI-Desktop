import { Capacitor } from "@capacitor/core";
import { FilePicker } from "@capawesome/capacitor-file-picker";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { RACP_DEFAULT_LIMITS, type MobileAttachmentRef } from "@pi-desktop/shared";
import type { MobileRelay } from "./relay";

export type PickedAttachment = { id: string; name: string; mimeType: string; size: number; blob: Blob };

export async function pickAttachments(imagesOnly: boolean): Promise<PickedAttachment[]> {
  const result = await FilePicker.pickFiles({ ...(imagesOnly ? { types: ["image/*"] } : {}), readData: false });
  return Promise.all(result.files.map(async (file) => {
    if (file.size > RACP_DEFAULT_LIMITS.maxAttachmentBytes) throw new Error("attachment_too_large");
    const source = file.webPath ?? (file.path ? Capacitor.convertFileSrc(file.path) : undefined);
    const blob = file.blob ?? (source ? await fetch(source).then((response) => response.blob()) : undefined);
    if (!blob) throw new Error("Unable to read selected file");
    return { id: crypto.randomUUID(), name: file.name, mimeType: file.mimeType, size: file.size, blob };
  }));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function uploadAttachment(relay: MobileRelay, sessionId: string, file: PickedAttachment): Promise<MobileAttachmentRef> {
  const { uploadId, chunkBytes } = await relay.request<{ uploadId: string; chunkBytes: number }>("attachment/create", { sessionId, name: file.name, mimeType: file.mimeType, size: file.size, kind: file.mimeType.startsWith("image/") ? "image" : "file" });
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new Error("Invalid attachment chunk size");
  for (let offset = 0; offset < file.blob.size; offset += chunkBytes) {
    const data = bytesToBase64(new Uint8Array(await file.blob.slice(offset, offset + chunkBytes).arrayBuffer()));
    await relay.request("attachment/write", { sessionId, uploadId, offset, data });
  }
  return (await relay.request<{ attachment: MobileAttachmentRef }>("attachment/complete", { sessionId, uploadId })).attachment;
}

export async function downloadAttachment(relay: MobileRelay, sessionId: string, messageId: string, attachmentId: string): Promise<{ blob: Blob; name: string }> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    const part = await relay.request<{ data: string; nextOffset: number; size: number; name: string; mimeType: string; eof: boolean }>("attachment/read", { sessionId, messageId, attachmentId, offset });
    chunks.push(base64ToBytes(part.data));
    if (part.eof) return { blob: new Blob(chunks, { type: part.mimeType }), name: part.name };
    if (!Number.isSafeInteger(part.nextOffset) || part.nextOffset <= offset) throw new Error("Invalid attachment response");
    offset = part.nextOffset;
  }
}

export async function saveAttachment(blob: Blob, name: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const safeName = name.replace(/[\\/:*?"<>|]/g, "_");
  const result = await Filesystem.writeFile({ directory: Directory.Cache, path: `pi-share/${crypto.randomUUID()}-${safeName}`, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), recursive: true });
  await Share.share({ files: [result.uri], title: name });
}
