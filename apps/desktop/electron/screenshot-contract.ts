/** Private bridge for the isolated screenshot selection windows. */
export const SCREENSHOT = {
  image: "pi-desktop/screenshot/image",
  ready: "pi-desktop/screenshot/ready",
  select: "pi-desktop/screenshot/select",
} as const;

export type ScreenshotRegion = { left: number; top: number; right: number; bottom: number };
export type ScreenshotBridge = {
  image: () => Promise<string>;
  ready: () => void;
  select: (region: ScreenshotRegion | null) => void;
};

/** Convert the overlay's normalized edges to physical image pixels. */
export function screenshotPixelRect(input: unknown, size: { width: number; height: number }) {
  if (!input || typeof input !== "object") throw new Error("Invalid screenshot region");
  const { left, top, right, bottom } = input as Record<string, unknown>;
  if (typeof left !== "number" || typeof top !== "number" || typeof right !== "number" || typeof bottom !== "number" ||
      ![left, top, right, bottom].every(Number.isFinite) ||
      left < 0 || top < 0 || right > 1 || bottom > 1 || left >= right || top >= bottom) {
    throw new Error("Invalid screenshot region");
  }
  const x = Math.round(left * size.width), y = Math.round(top * size.height);
  const width = Math.round(right * size.width) - x, height = Math.round(bottom * size.height) - y;
  if (!width || !height) return null;
  return { x, y, width, height };
}
