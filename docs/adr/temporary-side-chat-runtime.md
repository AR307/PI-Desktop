# ADR: Host-owned temporary side chats with in-memory inherited context

- Status: Accepted for the requested fork feature
- Date: 2026-10-19
- Partially supersedes: ADR 0268 selection overlay, quote transport, and side-chat retirement
- Preserves: retired decision/test identifiers and normal durable session forks

## Context

The requested interaction needs structured excerpts and concurrent Agent work
without copying a complete parent transcript to disk or introducing a second
Agent implementation. Renderer-owned chat history would violate authoritative
Host persistence and permit main/side event or approval mixing. A durable fork
would retain history after close, contrary to the required temporary lifetime.

## Decision

Host owns the child identity, unique parent relationship, workspace, temporary
records and deletion ordering. Existing session execution owns its Agent,
permissions, queues and tools. Renderer operations accept explicit session IDs.
Electron orchestrates open/close and sends exact Host-owned cleanup paths to
the operating system recycle bin before the Host removes child metadata.

At open, the runtime obtains current effective parent context through its
existing context builder, strips unfinished tool calls, and initializes the
child in memory. It stores only new child messages. Compaction of inherited
material and configuration-rebind context remain in memory. Edits, regeneration
and unanswered-stop rewind update the child runtime instead of dropping it and
attempting a disk-only reconstruction. When configuration requires a new runtime,
the disposed runtime transfers its existing entry buffers and compaction state;
child message IDs remain editable. This is an ownership transfer, not an extra
parent request snapshot or context cache.

References are a shared typed message field, serialized once as user reference
material. They are not system instructions or private provider protocol.

## Consequences

- Main and side can run concurrently in the same real workspace; completed
  writes are visible to both and are not undone by closing a side.
- Reopening a closed side creates fresh context, while hiding it retains its
  current independent conversation.
- App/sidecar restart cannot restore memory-only inherited context. App startup
  recycles stale children; a lost runtime reports an actionable reopen error.
- Schema 26 adds lifecycle/queue metadata without rewriting old transcripts.
- Native/remote adapters and durable alternate side-history revisions are outside this
  feature. Existing main conversation capabilities are unchanged.
- ADR 0268 remains historical evidence; its retired identifiers are not reused.
