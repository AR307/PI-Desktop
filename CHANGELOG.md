## v0.15.6-mirrorcoding.1

## Android companion update

- Cache each conversation's recent transcript on the phone and resume from the
  last event cursor, so reopening or reconnecting costs deltas instead of a
  full history download; the cache is cleared on logout and revocation.
- Refresh live session state through a light `session/state` call and reload
  the model catalog only when the configuration changes.
- Cap transcript fields at the desktop display window so long sessions with
  oversized messages open reliably, and fetch any capped card's full content
  on demand in chunks.
- Load earlier history automatically when scrolling to the top.
- Group subagent work into collapsible cards, render Edit/Write tool results
  as line diffs, and mark context compactions in the transcript.
- Manage queued prompts from the phone: preview, remove, and "send now" into
  the running turn.
- Keep streaming smooth on long conversations: per-frame event batching,
  memoized message rendering, and offscreen paint skipping.
- Refresh the UI with modular styles, screen transitions, loading skeletons,
  and a streaming caret, honoring reduced-motion settings.

## Android companion

- Share a project or session through an eight-digit, same-account MC pairing.
- View desktop history, live text, thinking, tools, plans and image results on
  Android; continue messages, queue work, stop tasks and resolve approvals.
- Transfer files and reference images, preview generated images and use Android
  save/share. Keep execution, complete history and attachments on the computer.
- Restore login and pairings after restart, reconnect without replaying an
  uncertain generation, and revoke mobile access from desktop settings.
- Refine the conversation header, composer, sheets and motion, and allow the
  phone to choose Agent/Plan/Goal/Image, model/group, reasoning and declared
  image parameters for the current shared session.
- Add the separate MC native login, device, pairing and relay team contract.

## Image generation

- Add an Agent/Plan/Goal/Image split mode button and separate per-session image selection.
- Filter model menus by chat/image capability and keep model/group billing visible.
- Generate from explicit prompts and references through pi's image provider,
  using main-owned MirrorCoding authentication and the selected group.
- Persist image cards with preview, save, reference reuse and download-only retry.
- Let chat agents query image models and generate images with their own selection.
- Cancel image work through Stop and account sign-out. Preserve chat reasoning
  and report uncertain generation failures without automatically replaying them.
- Define the server team's image catalog and endpoint requirements separately.

## Work-panel window behavior

- Allow native window dragging from empty space beside work-panel tabs.
- Keep browser pages responsive when screenshot capture overlaps panel or
  window resizing, including concurrent and failed captures.

## Branch follow-up

- Point in-app updates and GitHub issue feedback at AR307/PI-Desktop.
- Let a parent model start a subagent on another MirrorCoding chat model
  without an empty delegation-catalog error.
- Use the last in-scope conversation's model when opening a new chat, including
  the home Composer chip before the session is persisted.
- Load the PI-Desktop source icon for Windows windows when Electron's
  default executable icon would otherwise appear.

## MirrorCoding account integration

- Added optional first-launch authorization and Settings → Account.
- Automatically synchronize account models and groups; select model then group
  with account-specific multipliers and dynamic billing labels.
- Keep tokens encrypted in main and relay all model calls with the selected
  group, native protocol and reasoning parameters.
- Retain partial output on interruption, refresh expiring grants concurrently,
  and support offline sign-out with deferred server revocation.
- Center welcome and running-task confirmation dialogs at normal/narrow widths.
- Existing manual providers and vendor-account connections remain available.

This desktop/mobile package is published as a MirrorCoding preview. The MC
server-side catalog, authorization and relay contract remains a separately
deployed dependency.
