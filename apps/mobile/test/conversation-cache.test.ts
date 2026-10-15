import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileSession, MobileSessionSnapshot, MobileSessionState, RacpEventEnvelope, UiMessage } from "@pi-desktop/shared";
import { MobileConversation, type ConversationHost } from "../src/state/conversation";
import type { MobileRelay } from "../src/services/relay";
import { cacheKey, type CachedPage, type CachedTranscript, type TranscriptAddress, type TranscriptCache } from "../src/services/transcript-cache";
import { initialView, type MobileView } from "../src/state/view";

const address: TranscriptAddress = { accountId: "account", desktopDeviceId: "desktop", sessionId: "session" };
const message = (id: string, createdAt: string, content = id, role: UiMessage["role"] = "assistant"): UiMessage => ({ id, role, content, createdAt });
const session = { id: "session", title: "Session", status: "running", taskMode: "agent", capabilities: { canPrompt: true, canStop: true } } as unknown as MobileSession;
const state = (): MobileSessionState => ({
  session, queuedTurns: [], activeItems: [], pendingApprovals: [], pendingInputs: [], cursor: { epoch: "epoch", sequence: 9 },
  revision: 3, generatedAt: "2026-10-14T00:00:00Z", syncRevision: 5, imageJobs: [], plans: [],
});

/** IndexedDB stand-in that records every committed batch. */
function fakeCache(rows: UiMessage[]) {
  const stored = new Map(rows.map((row) => [row.id, row]));
  const snapshot: MobileSessionSnapshot = { ...state(), items: [], hasMoreHistory: false };
  let entry: CachedTranscript | undefined = { ...address, key: cacheKey(address), syncRevision: 5, cursor: { epoch: "epoch", sequence: 9 }, hasMoreHistory: false, oldestId: rows[0]?.id, oldestCreatedAt: rows[0]?.createdAt, snapshot };
  const commits: { messages: string[]; deleted: string[] }[] = [];
  const cache = {
    async page(): Promise<CachedPage> { return { entry, messages: [...stored.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), hasOlderCached: false }; },
    async message(_address: TranscriptAddress, id: string) { return stored.get(id); },
    async commit(next: CachedTranscript, messages: readonly UiMessage[], deleted: readonly string[] = []) {
      commits.push({ messages: messages.map((row) => row.id), deleted: [...deleted] });
      entry = next;
      for (const id of deleted) stored.delete(id);
      for (const row of messages) stored.set(row.id, row);
    },
    async clear() { stored.clear(); entry = undefined; },
  } as unknown as TranscriptCache;
  return { cache, stored, commits };
}

function fakeRelay(): MobileRelay {
  return {
    client: { state: "connected" },
    attach: async () => ({ kind: "state", state: state() }),
    state: async () => state(),
    changes: async () => ({ sessionId: "session", afterRevision: 5, revision: 5, hasMore: false, changes: [] }),
    modelCatalog: async () => ({ chat: [], image: [] }),
    detach: async () => {},
  } as unknown as MobileRelay;
}

function harness(rows: UiMessage[]) {
  let view: MobileView = { ...initialView(), signedIn: true, loading: false, desktopId: "desktop" };
  const errors: unknown[] = [];
  const relay = fakeRelay();
  const run = async (operation: () => Promise<void>) => { try { await operation(); } catch (error) { errors.push(error); } };
  const host: ConversationHost = {
    view: () => view, patch: (patch) => { view = { ...view, ...patch }; },
    action: run, background: run, report: (error) => errors.push(error),
    accountId: () => "account", relay: () => relay,
  };
  const cache = fakeCache(rows);
  const conversation = new MobileConversation(host, { cache: cache.cache, scheduler: { schedule: (flush) => flush(), cancel() {} }, persistDelayMs: 10 });
  return { conversation, cache, errors, view: () => view };
}

function envelope(sequence: number, event: unknown): RacpEventEnvelope {
  return { eventId: `event-${sequence}`, scope: "session", sessionId: "session", epoch: "epoch", sequence, revision: sequence, kind: "item.completed", occurredAt: "2026-10-14T00:00:10Z", payload: { event } };
}

describe("conversation cache writes", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("commits only the rows live events changed, and deletes rows they replaced", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => message(`m${index}`, `2026-10-14T00:00:${String(index).padStart(2, "0")}Z`));
    const { conversation, cache, errors, view } = harness(rows);
    await conversation.select("session");
    await vi.advanceTimersByTimeAsync(20);
    expect(view().messages).toHaveLength(40);
    cache.commits.length = 0;

    // A durable assistant row replaces its provisional one; a persisted user row replaces the optimistic one.
    conversation.handleEvent(envelope(10, { type: "message_start", message: message("provisional", "2026-10-14T00:01:00Z", "draft") }));
    conversation.handleEvent(envelope(11, { type: "message_end", replacesMessageId: "provisional", message: message("durable", "2026-10-14T00:01:00Z", "final") }));
    conversation.handleEvent(envelope(12, { type: "user_message_persisted", optimisticMessageId: "m39", message: message("user-1", "2026-10-14T00:00:39Z", "hello", "user") }));
    await vi.advanceTimersByTimeAsync(20);

    expect(errors).toEqual([]);
    const written = cache.commits.flatMap((commit) => commit.messages);
    expect(new Set(written)).toEqual(new Set(["durable", "user-1"]));
    expect(cache.commits.flatMap((commit) => commit.deleted).sort()).toEqual(["m39", "provisional"]);
    expect(cache.stored.has("provisional")).toBe(false);
    expect(cache.stored.has("m39")).toBe(false);
    expect([...cache.stored.keys()]).toContain("durable");
  });

  it("writes nothing but the position when no row changed", async () => {
    const { conversation, cache } = harness([message("m1", "2026-10-14T00:00:01Z")]);
    await conversation.select("session");
    await vi.advanceTimersByTimeAsync(20);
    cache.commits.length = 0;
    conversation.handleEvent({ ...envelope(13, undefined), kind: "turn.activity", payload: { configurationChanged: false } });
    await vi.advanceTimersByTimeAsync(20);
    expect(cache.commits.flatMap((commit) => commit.messages)).toEqual([]);
  });
});
