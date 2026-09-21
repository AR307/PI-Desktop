# Android companion and scoped desktop sync

The Android app uses the same MC account as desktop and a one-use pairing code
to access an explicitly shared project or session. Project shares include new
sessions as they join that project. A session share never expands to siblings.
Desktop must be running and connected; history and execution remain on desktop.

Desktop context menus expose Sync to mobile; account settings expose a manager
for pending codes and paired grants. Users can cancel/regenerate codes and
revoke devices. Restart preserves shares. Account changes disconnect peers.

Mobile offers login, verification challenges, pairing, shared project/session
navigation, history paging, streamed text/thinking/tools, image cards, approvals,
question answering, send and stop. It inherits desktop model, group, mode,
reasoning and permission settings. Direct images use ImageService. Unsupported
source capabilities remain read-only. No new project/session creation or
terminal/file browser is offered by the mobile profile.

Attachments are transferred in chunks and resolved to desktop-owned session
references before submission. History downloads resolve only attachments of an
authorized session. Ordinary files cannot serve as image-generation references.
Images can be saved/shared through Android. Pending image download retries do
not generate another image.

Chat sends use the existing task queue. Direct image generation rejects a busy
session and retains the draft. Both surfaces show the same persisted messages.
An approval can be resolved once; stale decisions report the resolved state.
Mobile backgrounding may suspend its connection. Foreground/reconnect restores
snapshots and events; uncertain sends are not replayed automatically. Revoking
access closes mobile streams without stopping an existing desktop task.

Process ownership remains renderer/preload/main/Rust+Node. MC owns native login,
device identity, pairings and online relay only. The runtime exposes an allowed
operation subset, never raw IPC, a terminal or unrestricted filesystem access.
MC credentials never enter mobile transcript state or desktop Node sidecar.

See [MC API handoff](../../mirrorcoding-mobile-sync-requirements.md) and
[architecture decision](../../adr/mobile-companion-relay.md). Local fixture
acceptance is distinct from MC-team service acceptance and production deployment.
