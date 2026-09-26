import { describe, expect, it } from "vitest";
import type { UiMessage } from "@pi-desktop/shared";
import {
  MemoryTranscriptCache,
  TRANSCRIPT_CACHE_MESSAGE_LIMIT,
  boundedCacheMessages,
  cacheKey,
} from "../src/services/transcript-cache";

function message(id: string): UiMessage {
  return { id, role: "assistant", content: id, createdAt: `2026-09-26T00:00:${id.padStart(2, "0")}.000Z` };
}

function entry(desktop: string, grant: string, session: string, messages: UiMessage[]) {
  return {
    key: cacheKey(desktop, session),
    desktopDeviceId: desktop,
    grantId: grant,
    sessionId: session,
    cursor: { epoch: "ep_1", sequence: 7 },
    revision: 3,
    hasMoreHistory: true,
    messages,
    updatedAt: 1,
  };
}

describe("transcript cache", () => {
  it("stores and returns the cached tail per desktop and session", async () => {
    const cache = new MemoryTranscriptCache();
    await cache.put(entry("desk-1", "grant-1", "s1", [message("1")]));
    const cached = await cache.get("desk-1", "s1");
    expect(cached?.cursor).toEqual({ epoch: "ep_1", sequence: 7 });
    expect(cached?.messages.map((row) => row.id)).toEqual(["1"]);
    expect(await cache.get("desk-2", "s1")).toBeUndefined();
  });

  it("clears exactly the revoked grant's transcripts", async () => {
    const cache = new MemoryTranscriptCache();
    await cache.put(entry("desk-1", "grant-1", "s1", [message("1")]));
    await cache.put(entry("desk-1", "grant-2", "s2", [message("2")]));
    await cache.clearGrant("grant-1");
    expect(await cache.get("desk-1", "s1")).toBeUndefined();
    expect((await cache.get("desk-1", "s2"))?.sessionId).toBe("s2");
    await cache.clearAll();
    expect(await cache.get("desk-1", "s2")).toBeUndefined();
  });

  it("bounds the persisted tail so one long session cannot grow unbounded", () => {
    const long = Array.from({ length: TRANSCRIPT_CACHE_MESSAGE_LIMIT + 25 }, (_, index) => message(String(index)));
    const bounded = boundedCacheMessages(long);
    expect(bounded).toHaveLength(TRANSCRIPT_CACHE_MESSAGE_LIMIT);
    expect(bounded[0]?.id).toBe("25");
    expect(bounded.at(-1)?.id).toBe(String(TRANSCRIPT_CACHE_MESSAGE_LIMIT + 24));
  });
});
