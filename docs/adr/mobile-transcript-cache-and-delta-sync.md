# ADR: Mobile transcript cache and delta sync

- Status: Accepted by the implementation request
- Date: 2026-09-26
- Related: `mobile-companion-relay.md`, ADR 0265, `docs/spec/03-runtime/23-mobile-companion.md`

## Context

The Android companion re-downloaded a full 50-item transcript snapshot on every
conversation open, every reconnect, and after every non-streaming event, plus a
model-catalog fetch per refresh. Over a metered mobile connection this made a
stable session cost megabytes per day. Separately, the mobile read path applied
no per-field content cap, so a single multi-megabyte tool result pushed the
snapshot response past the 1 MiB RACP frame limit and the session could not be
opened at all. The desktop already owned everything needed to do better: durable
event cursors with a bounded replay window, stable message ids, and the
renderer's own 64 KiB display cap in host-core.

## Decision

1. **Light state (`session/state`)**: the snapshot minus its transcript page.
   `AgentHost.sessionState` assembles it without a history query; the mobile
   peer serves it and uses it internally wherever a full snapshot was fetched
   only for turn/approval/input checks. The phone refreshes live state through
   it instead of re-downloading the transcript, and refreshes the model catalog
   only on open, after configure, and on a `configurationChanged` push.
2. **Cursor-resumed attach**: `session/attach` honors `includeSnapshot: false`
   and returns the light state; the phone resumes `events/subscribe` from its
   stored cursor and falls back to one full snapshot when the subscription
   reports `replayComplete: false`.
3. **On-device cache**: the phone persists a bounded per-session tail (newest
   ~500 rows) with the last durable cursor in IndexedDB. The cache is cleared
   on logout, on revocation from either side, and when a grant disappears from
   the account, so a cached transcript never outlives its share. The user
   accepted this data-at-rest change explicitly.
4. **Presentation cap + full-content reads**: mobile transcript reads pass
   `MOBILE_ITEM_CONTENT_LIMIT` (64 KiB, the desktop renderer's window) through
   `AgentHost` into host-core's `content_limit`. host-core's display truncation
   marker identifies capped fields; `session/item` streams the complete item
   JSON in `attachment/read`-style chunks on demand.
5. **Queue vocabulary on mobile**: the peer forwards `turn/prioritize`
   ("send now", steered into the running turn per ADR 0265) alongside the
   existing `turn/cancel`, and the projections carry bounded queued-prompt
   previews and compaction marks so the phone can render queue management,
   subagent groups (`parentToolCallId`), and compaction dividers.
6. **Compatibility**: all additions are optional and advertised through the
   `sessionState` / `itemContent` capability flags. An old phone against a new
   desktop keeps the original contract; a new phone against an old desktop
   detects the missing flags and uses the full-snapshot path.

## Alternatives and consequences

- Server-side per-device diff state was rejected: the durable event stream with
  client cursors already expresses the delta, and desktop-held per-phone state
  would add an ownership surface for no bandwidth win.
- Uncapped transcript frames with relay-side chunking was rejected: chunking a
  frame the client cannot bound still transfers the megabytes; the renderer's
  display cap plus on-demand full reads matches desktop behavior.
- Encrypting the on-device cache was deferred: tokens stay in native secure
  storage; the transcript cache lives in app-private storage and is cleared
  with the share. Revisit if the companion adds multi-account profiles.
- The full transcript and attachments remain desktop-owned; the cache is a
  presentation tail, never an offline source of truth.
