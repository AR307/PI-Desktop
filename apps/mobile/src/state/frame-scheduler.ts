/**
 * Coalesces bursts of work into one flush per painted frame. A hidden WebView
 * never runs animation frames, so every request also arms a timer: whichever
 * fires first flushes, which keeps live events applied while the app is in
 * the background instead of piling up until the next foreground.
 */
export type FrameScheduler = {
  schedule(flush: () => void): void;
  cancel(): void;
};

export type FrameEnvironment = {
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  setTimer(callback: () => void, delay: number): unknown;
  clearTimer(handle: unknown): void;
  hidden(): boolean;
};

/** Visible pages normally paint long before this; hidden pages use it alone. */
export const FRAME_FALLBACK_MS = 120;

export function browserFrameEnvironment(): FrameEnvironment {
  return {
    ...(typeof requestAnimationFrame === "function" ? { requestFrame: (callback) => requestAnimationFrame(callback), cancelFrame: (handle) => cancelAnimationFrame(handle) } : {}),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  };
}

export function createFrameScheduler(environment: FrameEnvironment = browserFrameEnvironment()): FrameScheduler {
  let frame: number | undefined;
  let timer: unknown;
  let pending: (() => void) | undefined;
  const clear = () => {
    if (frame !== undefined) environment.cancelFrame?.(frame);
    if (timer !== undefined) environment.clearTimer(timer);
    frame = undefined; timer = undefined;
  };
  const run = () => {
    const flush = pending;
    pending = undefined;
    clear();
    flush?.();
  };
  return {
    schedule(flush) {
      pending = flush;
      if (frame !== undefined || timer !== undefined) return;
      if (environment.requestFrame && !environment.hidden()) frame = environment.requestFrame(run);
      timer = environment.setTimer(run, FRAME_FALLBACK_MS);
    },
    cancel() { pending = undefined; clear(); },
  };
}
