# Android companion and scoped desktop sync

The Android app uses the same MC account as desktop and a one-use pairing code
to access explicitly shared computers, projects or sessions. Account pairing
discovers every computer that has opted into account sharing. Project shares
include new sessions as they join that project; a session share never expands
to siblings. Live operations require an online desktop. Cached history is
readable offline; desktop remains the authority for history and execution.

Desktop context menus expose Sync to mobile; account settings expose a manager
for pending codes and paired grants. Users can cancel/regenerate codes and
revoke devices. Restart and mobile token refresh preserve shares. Account changes
disconnect peers. Explicit mobile logout clears local credentials and the saved
device registration; a later password login registers and pairs again. Account
grant management on desktop can revoke old registrations' shares without allowing a new
mobile device to use them.

Device creation sends only kind/name. MC returns the installation ID and a
one-time secret; desktop keeps both in encrypted main-process storage and Android
keeps both in secure credential storage. Restarts and token rotation reuse that
identity. Desktop reauthorization supplies both fields once for the new
authorization; catalog/grant refreshes never register again. A missing secret
requires explicit sign-out and pairing again, not a guessed client device ID.
Explicit desktop logout also clears its encrypted installation credentials and
local share scopes after account revocation. Reauthorization without logout
retains the installation identity and its scopes.

Mobile login first reads MC's encryption policy and uses RSA-OAEP-256 when enabled.
Account/sync HTTP 429 and 503 preserve credentials and honor Retry-After, including
responses with no JSON body. Pairing stops when connection initialization fails.
Both interfaces show actionable account/service errors and the supplied retry
time. Authentication cooldown is independent of model request retries.

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

The phone stores account-scoped computer/project/session indexes and every loaded
message in IndexedDB. It displays cached directories and a local message page
before refreshing online. Earlier pages load locally before requesting missing
history. Downloaded attachments and expanded message content remain available
offline. There is no 500-row cap and no offline command queue.

Rust schema 22 owns a durable per-session sync revision and change index for
upserts/deletions. Cached sessions attach with light live state, fetch paged
`session/changes` since the saved revision, then merge subscribed events.
A desktop restart or expired live cursor never clears local history. Snapshot
and history pages carry the revision captured with that page. An older history
page does not advance the global sync position; only applied change batches do.
Message batches and positions are committed together. Cache failures are visible
and do not silently re-download all history. Confirmed authorization loss and
explicit logout clear the affected account/computer/session data.

Account pairing is independent of a computer. The desktop must explicitly enable
account sharing before the account grant permits its content. New opted-in
computers appear automatically; other phones still pair separately. Directories
include empty projects, archived entries and ungrouped conversations. Project IDs
and identical paths remain separated by computer. The mobile app holds one relay
per accessible computer, subscribes only to directory metadata outside the active
conversation, and refreshes account discovery on notifications/foreground.

Account-sharing changes remain visibly pending until MC acknowledges them.
Transient publication failures retry through the existing desktop sync timer,
respecting `Retry-After`; permanent request errors require correction. Account
pairing is unavailable while publication is pending. The saved local choice
continues to control desktop access, including an immediate local opt-out.

Authorized offline computers remain in the directory with their cached history.
Discovery and reopening cached work do not request relay tickets for a computer
declared offline. `DESKTOP_OFFLINE` closes its relay without a global error or a
reconnect loop; later online discovery reconnects it. `GRANT_REVOKED` closes the
old relay and refreshes grants/devices before requesting another ticket. A
remaining project/session grant retains only its own cached content and can
reconnect, without widening access or stopping desktop work. Account/discovery
notifications received during a refresh trigger a follow-up refresh.

Pairing failures identify wrong accounts, invalid/used/expired codes and revoked
sharing in English and Chinese. The pairing sheet keeps the code beside its
error, the login and unrelated grants. Desktop sharing errors preserve the MC
error code for an actionable explanation instead of a generic connection error.


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

`connection/initialize` advertises `sessionState` and `itemContent`. This mobile
client requires the current light-state/durable-change contract; a missing state
response is a protocol error, not a reason to replace cached history.

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
truncation marker. Whole items and pages are also bounded so many individually
small tool blocks cannot exceed the relay frame. Omitted older rows remain
available through backward paging. The phone shows the full content on demand through
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

## Session Fast (2026-09-30)

The same configuration also carries session-local `ultra` independently of
Fast. Current snapshots show effective native reasoning; next/chat selections
retain the preference. Child cards show accepted model/group/native level, and
changing model/group resets Ultra. See [Ultra collaboration](ultra-collaboration.md).

The existing model sheet stages Fast with model/group/reasoning and applies one
session/configure write. Catalog choices expose fastAvailable and an unavailable
reason. Session configuration includes Fast in current, next and remembered chat
selections; current is captured at desktop launch, not from next-turn settings.
Image mode sends no Fast, and returning to chat restores its saved choice.
Running chat edits affect the next turn only; image and auxiliary requests do not
inherit it. MC transports these existing RACP payloads without new server state.


## Android application updates

Account settings show the installed Android version, manual update check,
release notes and native download/install actions, including while signed out.
Startup/foreground checks run at most daily; failures affect only updates.
`AR307/Mirrorcoding-APP` is the sole release source. Build metadata generates
`mobile-update.json` alongside the APK. DownloadManager keeps tasks across
process restarts; explicit installation uses FileProvider and Android's system
installer with the unknown-source permission flow. Application ID/signing stay
the same and `versionCode` increases. No silent installation or web-resource hot
update is supported. The first updater APK is installed manually.
