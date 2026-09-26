# Android companion and scoped desktop sync

The Android app uses the same MC account as desktop and a one-use pairing code
to access an explicitly shared project or session. Project shares include new
sessions as they join that project. A session share never expands to siblings.
Desktop must be running and connected; history and execution remain on desktop.

Desktop context menus expose Sync to mobile; account settings expose a manager
for pending codes and paired grants. Users can cancel/regenerate codes and
revoke devices. Restart and mobile token refresh preserve shares. Account changes
disconnect peers. Explicit mobile logout clears local credentials and the saved
device registration; a later password login registers and pairs again. Account
grant management on desktop can revoke old registrations' shares without allowing a new
mobile device to use them.

Mobile offers login, verification challenges, pairing, shared project/session
navigation, history paging, streamed text/thinking/tools, pending plans, image
cards, approvals, question answering, send and stop. It can update the current
shared session's Agent/Plan/Goal/Image mode, model/group, reasoning level and
declared image parameters. Permission settings remain desktop-owned. Direct
images use ImageService. Unsupported source capabilities remain read-only. No
new project/session creation, provider management, terminal or file browser is
offered by the mobile profile.

The conversation header shows the session, desktop and connection state without
an extra online banner. Mode and model controls open accessible bottom sheets;
account/pairing share the same surface behavior, while destructive confirmation
uses a centered dialog. Android Back closes the innermost surface before leaving
the conversation. Sheets preserve unsaved choices while transcript snapshots
continue to stream, and respect reduced-motion and safe-area settings.

Attachments are transferred in chunks and resolved to desktop-owned session
references before submission. History downloads resolve only attachments of an
authorized session. Ordinary files cannot serve as image-generation references.
Images can be saved/shared through Android. Pending image download retries do
not generate another image.

Chat sends use the existing task queue. A mobile UUID is retained as the queued
turn's user message identity and the persisted user row ID, including after a
desktop restart. Direct image generation rejects a busy session and retains the
draft. Both surfaces show the same persisted messages. The phone Stop button
uses `turn/interrupt` to abort active runtime work or image generation;
`turn/stop` retains RACP's cooperative stop behavior.
An approval can be resolved once; stale decisions report the resolved state.
Plan/Goal approvals belong to the session and remain visible after the planning
turn ends. Snapshots restore still-pending proposals from Rust when a phone
reconnects or AgentHost is recreated while Rust remains available, retaining
their host expiry and using the existing plan resolution flow. A full desktop
restart preserves the existing Rust behavior: pending proposals become
interrupted and cannot be approved as if they were still pending.
Mobile backgrounding may suspend its connection. Foreground/reconnect restores
live state and events. Lost send acknowledgements are reconciled through
`message/status` (`running`, `queued`, `persisted`, or `unknown`); uncertain sends
are not replayed automatically. Revoking
access closes mobile streams without stopping an existing desktop task.

The phone keeps a bounded per-session transcript cache (IndexedDB, newest ~500
rows with the last durable event cursor). Reopening a conversation renders the
cached tail immediately, attaches with `includeSnapshot: false`, and resumes
`events/subscribe` from the stored cursor, so a stable session costs deltas
instead of a full snapshot; within one app run a reconnect resumes from the
live in-memory transcript the same way. When the cursor left the replay window
(`replayComplete: false`), when the desktop predates the light path, or when no
cache exists, the client falls back to the full snapshot and rebuilds the
cache. Cached transcripts never outlive the share that authorized them: they
are cleared on logout, on revocation from either side, and whenever a grant
disappears from the account.

Process ownership remains renderer/preload/main/Rust+Node. MC owns native login,
device identity, pairings and online relay only. The runtime exposes an allowed
operation subset, never raw IPC, a terminal or unrestricted filesystem access.
MC credentials never enter mobile transcript state or desktop Node sidecar.

`session/list` optionally filters to one grant. Enriched session snapshots include
the actual provider/model/group, task mode, image configuration, pending plans,
current image jobs, bounded queued-prompt previews and compaction marks. They
distinguish the running task's captured selection
when known from the persisted next-turn selection and preserve separate chat and
image choices. `session/modelCatalog` exposes only selectable display/capability
metadata, and the phone refreshes it only on open, after `session/configure`,
and on a `configurationChanged` activity push. `session/configure` validates an
atomic provider/model choice and
updates only the authorized session. Mobile responds to image progress and
desktop configuration changes through ephemeral `turn.activity` events, then
reads the current live state. History pages use bounded Rust queries. Each command,
subscription and outbound event rechecks current project/session membership.

`connection/initialize` advertises the additions with the optional
`sessionState` and `itemContent` capability flags; a client that does not see
them uses the original full-snapshot contract unchanged.

`session/state` returns the snapshot minus its transcript page (session
description, active/queued turns, pending approvals/inputs, plans, image jobs,
queued-prompt previews, compaction marks, cursor, revision). The phone uses it
for every live-state refresh so a running conversation no longer re-downloads
its transcript per event. `session/attach` with `includeSnapshot: false`
returns that state in place of the snapshot for cursor-resuming clients.

Transcript reads on the mobile profile apply a per-field presentation cap
(`MOBILE_ITEM_CONTENT_LIMIT`, 64 KiB — the desktop renderer's window), so one
oversized message can no longer burst the relay frame limit and make a long
session unopenable. host-core marks a capped field by appending its display
truncation marker; the phone shows the full content on demand through
`session/item`, which streams the complete item JSON in relay-safe chunks like
`attachment/read`. The uncapped transcript remains desktop-owned.

Queue management uses the shared turn vocabulary: `turn/cancel` removes a
queued turn and `turn/prioritize` is "send now" — the promoted prompt joins the
running turn when the runtime supports steering (ADR 0265). The transcript
groups delegate-produced rows by their `parentToolCallId` into collapsible
subagent cards and renders compaction dividers from the projected marks.

Chat model and reasoning changes may be saved while a task is active and apply
to the next admitted turn; the active turn and its tool continuations keep their
captured launch configuration. Mode changes wait until the task and pending
approval are idle. Chat and image selections are remembered independently.
MirrorCoding uses model then group with real billing metadata; other configured
desktop providers remain source-distinguishable. Image parameters are limited to
the selected model's declared sizes, ratios, qualities and count.

See [MC API handoff](../../mirrorcoding-mobile-sync-requirements.md) and
[architecture decision](../../adr/mobile-companion-relay.md). Local fixture
acceptance is distinct from MC-team service acceptance and production deployment.
