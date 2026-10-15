import { describe, expect, it } from "vitest";
import { createFrameScheduler, type FrameEnvironment } from "../src/state/frame-scheduler";

function environment(hidden: boolean) {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let next = 1;
  const env: FrameEnvironment = {
    requestFrame: (callback) => { const id = next++; frames.set(id, callback); return id; },
    cancelFrame: (id) => { frames.delete(id); },
    setTimer: (callback) => { const id = next++; timers.set(id, callback); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    hidden: () => hidden,
  };
  const fire = (queue: Map<number, () => void>) => { for (const [id, callback] of [...queue]) { queue.delete(id); callback(); } };
  return { env, frames, timers, paint: () => fire(frames), tick: () => fire(timers) };
}

describe("live event frame scheduling", () => {
  it("still flushes when a backgrounded WebView never paints another frame", () => {
    const { env, frames, tick } = environment(true);
    const scheduler = createFrameScheduler(env);
    let flushed = 0;
    scheduler.schedule(() => { flushed += 1; });
    scheduler.schedule(() => { flushed += 1; });
    expect(frames.size).toBe(0);
    tick();
    expect(flushed).toBe(1);
  });

  it("flushes once per painted frame and drops the fallback timer", () => {
    const { env, timers, paint, tick } = environment(false);
    const scheduler = createFrameScheduler(env);
    const calls: string[] = [];
    scheduler.schedule(() => calls.push("first"));
    scheduler.schedule(() => calls.push("latest"));
    paint();
    expect(calls).toEqual(["latest"]);
    expect(timers.size).toBe(0);
    tick();
    expect(calls).toEqual(["latest"]);
  });

  it("recovers when the page is hidden after a frame was requested", () => {
    const { env, tick } = environment(false);
    const scheduler = createFrameScheduler(env);
    let flushed = false;
    scheduler.schedule(() => { flushed = true; });
    tick();
    expect(flushed).toBe(true);
  });

  it("cancels pending work", () => {
    const { env, paint, tick } = environment(false);
    const scheduler = createFrameScheduler(env);
    let flushed = false;
    scheduler.schedule(() => { flushed = true; });
    scheduler.cancel();
    paint(); tick();
    expect(flushed).toBe(false);
  });
});
