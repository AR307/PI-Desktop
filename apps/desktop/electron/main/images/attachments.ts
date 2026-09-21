import type { GeneratedImage, ImageOutput } from "@pi-desktop/shared";
import { ensureAttachmentBlob } from "../prompt-attachments";

/** Downloads are anonymous. A failed download is retried without regenerating. */
export async function persistGeneratedImage(dataDir: string, output: ImageOutput, id: string, signal: AbortSignal): Promise<GeneratedImage> {
  let sourceUrl: string | undefined;
  try {
    let bytes: Buffer;
    let mimeType = output.mimeType || "image/png";
    if (output.data) {
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(output.data);
      if (match?.[1]) mimeType = match[1];
      bytes = Buffer.from(match ? match[2] : output.data, "base64");
    } else if (output.url) {
      const url = new URL(output.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_image_url");
      sourceUrl = url.toString();
      const response = await fetch(sourceUrl, { signal, redirect: "follow", credentials: "omit" });
      if (!response.ok) throw new Error("image_download_failed");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
      if (!contentType?.startsWith("image/")) throw new Error("invalid_image_response");
      mimeType = contentType;
      bytes = Buffer.from(await response.arrayBuffer());
    } else throw new Error("invalid_image_response");
    if (!bytes.length || !mimeType.startsWith("image/")) throw new Error("invalid_image_response");
    const extension = mimeType.split("/", 2)[1]?.replace(/[^a-z0-9]/gi, "") || "png";
    return { id, attachment: { kind: "image", name: `generated-${id}.${extension}`,
      ref: ensureAttachmentBlob(dataDir, bytes), mimeType, size: bytes.length } };
  } catch {
    return { id, ...(sourceUrl ? { downloadUrl: sourceUrl } : {}), error: "image_download_failed" };
  }
}
