import type { MobileSessionSnapshot, RacpCursor, UiMessage } from "@pi-desktop/shared";
import { cacheKey, TranscriptCache, type CachedTranscript, type TranscriptAddress } from "../services/transcript-cache";
import type { MobileRelay } from "../services/relay";
import { itemMessage, mergeMessages, snapshotMessages } from "./transcript";

/** Owns the persisted position; live state refreshes never advance it. */
export class MobileHistory {
  entry?: CachedTranscript;
  private active = true;
  private writes: Promise<void> = Promise.resolve();
  private operations: Promise<unknown> = Promise.resolve();
  constructor(readonly address: TranscriptAddress, private cache: TranscriptCache) {}
  /** Paging, reconciliation and expansion each own their complete UI/cache update. */
  run<T>(action: () => Promise<T>): Promise<T> {
    const job = this.operations.then(action);
    this.operations = job.catch(() => undefined);
    return job;
  }
  async read() {
    const page = await this.cache.page(this.address);
    this.entry = page.entry;
    return page;
  }
  async initialize(snapshot: MobileSessionSnapshot) {
    const messages = snapshotMessages(snapshot);
    this.entry = { ...this.address, key: cacheKey(this.address), syncRevision: snapshot.syncRevision,
      cursor: snapshot.cursor, hasMoreHistory: snapshot.hasMoreHistory, oldestId: messages[0]?.id, oldestCreatedAt: messages[0]?.createdAt,
      snapshot: { ...snapshot, items: [], activeItems: [] } };
    await this.save(messages);
  }
  save(messages: readonly UiMessage[], snapshot?: MobileSessionSnapshot, cursor?: RacpCursor, deleted: string[] = []) {
    if (!this.entry || !this.active) return Promise.resolve();
    this.entry = { ...this.entry, ...(snapshot ? { snapshot: { ...snapshot, items: [], activeItems: [] } } : {}), ...(cursor ? { cursor } : {}) };
    const entry = this.entry;
    const job = this.writes.then(() => this.active ? this.cache.commit(entry, messages, deleted) : undefined);
    this.writes = job.catch(() => undefined);
    return job;
  }
  async close(): Promise<void> { this.active = false; await this.writes; }
  async changes(relay: MobileRelay, messages: UiMessage[], valid: () => boolean): Promise<UiMessage[]> {
    if (!this.entry) return messages;
    await this.writes;
    while (this.entry) {
      const previous: CachedTranscript = this.entry;
      const page = await relay.changes(this.address.sessionId, previous.syncRevision);
      if (!valid() || !this.active) return messages;
      const deleted = page.changes.filter((change) => change.kind === "delete").map((change) => change.messageId);
      const incoming = page.changes.flatMap((change) => change.kind === "upsert" ? [itemMessage(change.item)].filter((item): item is UiMessage => Boolean(item)) : []);
      // Do not create isolated old rows outside the contiguous loaded range.
      // Those rows are read at their current value when the user pages there.
      const upserts: UiMessage[] = [];
      for (const message of incoming) {
        if (!previous.oldestCreatedAt || message.createdAt >= previous.oldestCreatedAt || await this.cache.message(this.address, message.id)) upserts.push(message);
      }
      if (!valid() || !this.active) return messages;
      this.entry = { ...previous, syncRevision: page.revision };
      try { await this.save(upserts, undefined, undefined, deleted); }
      catch (error) { this.entry = previous; throw error; }
      if (!valid()) return messages;
      messages = mergeMessages(messages.filter((message) => !deleted.includes(message.id)), upserts.filter((message) => !messages.length || message.createdAt >= messages[0]!.createdAt || messages.some((row) => row.id === message.id)));
      if (!page.hasMore) return messages;
    }
    return messages;
  }
  async earlier(first: UiMessage, relay?: MobileRelay) {
    const local = await this.cache.page(this.address, first);
    if (local.messages.length || !relay || !this.entry?.hasMoreHistory) return {
      messages: local.messages, hasMore: local.hasOlderCached || Boolean(this.entry?.hasMoreHistory),
    };
    const beforeRevision = this.entry.syncRevision;
    const page = await relay.history(this.address.sessionId, first.id);
    if (!this.active) return { messages: [], hasMore: false };
    const messages = page.items.flatMap((item) => { const message = itemMessage(item); return message ? [message] : []; });
    // A history page covers an older range, so its revision cannot advance the
    // session-wide position. changes() still reconciles concurrent deletions.
    this.entry = { ...this.entry, syncRevision: Math.min(this.entry.syncRevision, beforeRevision), hasMoreHistory: page.hasMore, oldestId: messages[0]?.id ?? this.entry.oldestId, oldestCreatedAt: messages[0]?.createdAt ?? this.entry.oldestCreatedAt };
    await this.save(messages);
    return { messages, hasMore: page.hasMore };
  }
}
