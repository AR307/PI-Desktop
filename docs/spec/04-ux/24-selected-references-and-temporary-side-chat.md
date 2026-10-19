# Selected references and temporary side chat

Status: Implemented locally; release validation is recorded separately.

## User workflow

Selecting visible text in a local Desktop user message or assistant response
opens **Add to conversation** and **Ask in side chat**. Code preserves line
breaks; rendered math uses its TeX source. A selection crossing messages creates
one reference per source message. Buttons, inputs, hidden content, and existing
reference controls are excluded. Tab enters the toolbar; Escape dismisses it.
The actions use compact ghost buttons without an enclosing bordered, rounded
or raised container, matching the existing Desktop toolbar controls.

Add to conversation appends structured references without replacing typed text
or attachments and without sending. A borderless reference count expands to
numbered excerpts with a subtle quote rail. Hovering or focusing the numbered
source reveals full session/message identities; IDs do not clutter the excerpt.
Draft references use a small close-icon control with an accessible remove label.
Main chat, side chat and sent references share this presentation. References
travel with ordinary sends, queued sends, immediate
steering, main and side message edits/retries, and unanswered-stop draft restoration.
They remain structured in stored messages; one shared conversion produces
user-role reference material followed by the question. No system-role promotion
or Codex-private annotation protocol is used.

## Temporary execution

Each main conversation owns at most one side chat. Re-selecting text reuses it,
appends references, preserves its draft, and focuses its composer. Opening does
not send a prompt. A new side chat inherits the resolved model, provider,
reasoning level, mode, Fast/Ultra choices and effective permission policy. Its
configuration and subsequent context evolve independently.

The existing Agent runtime, tools, approvals, queue, stop controls, and events
execute under a distinct session identity. The side uses the parent's actual
working directory, including an isolated parent's worktree. There is no second
worktree, merge, or rollback of completed file changes.

The initial context is built on demand from the parent's current effective
runtime context, or restored canonical transcript plus compaction checkpoint
and hydrated attachments. It is not reconstructed from visible UI rows.
Completed tool results are evidence, not executable tasks. Incomplete tool
calls and uncommitted streamed assistant text are not inherited; selected
streamed text can still be sent as an explicit reference. Failed context reads
show an error and can be retried; no empty-context side chat is substituted.

Inherited context lives only in the side runtime's required memory. Child
JSONL contains only the child's new records. Side compaction stays in memory
so it cannot write a summary of parent history into the child checkpoint.
Changing child configuration retains its effective context, compaction and
child message identities, including across runtime reconstruction. Smart Stop,
edit and regeneration rewind child turns in memory rather than disposing this context.

## Layout and lifetime

The side is a session-owned WorkPanel tab. Switching conversations or tabs,
opening Settings, or collapsing the panel hides it without discarding it. On
narrow windows it overlays the right side instead of squeezing the main chat;
the temporary drawer width is not saved as a preferred panel width. The side
uses a 360px rendered minimum so its tab/close controls remain accessible beside
the Windows titlebar; old compact preferences and unrelated panels are unchanged.

The transcript and composer use the main chat's shared surface, spacing and
single-row responsive toolbar. The composer is an overlay: its measured height
is reserved exactly once by the transcript, including when references or a
multiline draft grow it. It must not leave an extra hidden band above the input.
Narrow panes compact model/mode labels and account quota controls without
overlapping action targets; full labels remain available through tooltips and
menus. Expanding the pane restores descriptive labels on the same row.

Explicit tab close confirms when a draft, queued input, running task, delegate,
or unanswered interaction exists. It cancels work, clears the queue, waits for
runtime settlement, recycles app-owned child transcript/scratch files, and
releases state. Project files remain unchanged. Startup recycles stale child
records before normal history/mobile restoration; no side prompt is replayed.
Closing also cancels tools waiting for permission before they can execute,
and waits for child delegates to settle.

Background-command bars belong to their Composer session, not both panes.
A running detached command also requires close confirmation. Confirmed side
closure stops and reaps its background commands before recycling app-owned
files; ordinary turn cancellation still leaves detached commands alive.
The parent's background commands are not stopped by closing its side chat.

Host schema 26 adds parent-child lifecycle ownership and queued reference
metadata. Existing transcripts are not rewritten. Temporary sessions are
excluded from ordinary history, global search, mobile sharing, and reusable
main-session selection. Parent deletion requires closing its child first.

## Scope

This feature targets Host-owned local Desktop conversations, not native Pi or
remote-session protocol adapters. Side chats have Agent execution capabilities,
not a second durable-history editor: fork/revision actions and app-global
plugin-composer/voice dispatch remain main-conversation surfaces. Side edits and
regeneration rewind the child's own turns without discarding inherited context;
they do not create durable alternate revisions. Session mode,
compact, and trusted-extension slash commands target the side explicitly;
app-global commands report their main-only scope rather than switching it. Ordinary
side questions, attachments, tools, approval, queues, and model/mode controls use
the existing session-specific paths. No server changes or release bump.

## Verification

See [the E2E plan](../06-delivery/04-e2e-test-plan.md#selected-references-and-temporary-side-chat)
and [the architecture decision](../../adr/temporary-side-chat-runtime.md).
Executed results and platform limitations are recorded in
[local validation](../../selection-side-chat-validation.md).
