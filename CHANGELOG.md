## Unreleased - Agent image result visibility

- Keep authorized-account image results in the final reply area instead of
  hiding them when tool processing collapses. Expanding details does not
  duplicate images; preview, save, references and saved-history display remain
  available without generating again.

## Unreleased - Claude cache duration in the composer

- Select five-minute or one-hour Claude prompt caching directly below the
  reasoning slider in the main-page model menu. The choice saves immediately
  and shares the model preference with advanced settings and MirrorCoding.

## Unreleased - Upstream v0.21.0-beta.4 synchronization

- Integrate the upstream sidebar submenus, background commands, plugin and
  transcript improvements, and work-panel width recovery while retaining the
  MirrorCoding fork's mobile, storage, image, account and side-chat features.
- Keep background commands scoped to their conversation in both composers.
  Closing a temporary side chat now confirms and stops its detached commands
  before recycling its records without stopping parent-conversation work.
- Preserve Image generation in the compact mode menu and keyboard navigation.

## Unreleased - Side-chat layout

- Simplify selected-text actions and annotations in main and side chat: compact
  ghost actions, borderless reference disclosure, small remove icons and source
  details on hover or keyboard focus instead of long IDs in the composer.
- Remove the duplicate composer-height transcript mask in temporary side chats.
  Main and side chat now share composer spacing, surface and responsive toolbar
  layout, with non-overlapping signed-in controls at narrow widths.

## Unreleased - MirrorCoding account benefits

- Add a text-free subscription quota bar before the desktop model picker.
  Hover shows remaining percentage; click shows every active plan's quota,
  expiry and reset, plus a manual daily check-in action. Account settings
  expose the same panel.
- Add explicit permission, unavailable and verification states. Requires the
  new MirrorCoding Pi account-benefit endpoints and consent; no server
  deployment or client release is included.

## Unreleased - Desktop selected references and temporary side chat

- Select message text to attach source-aware references without replacing the
  current draft. References survive sending, queue editing and Smart Stop.
- Ask follow-up questions in a temporary WorkPanel Agent chat that inherits
  current effective context and shares the main conversation's workspace.
  Closing cancels its work and recycles temporary records, not project files.

## v0.20.4 (Android) - In-app update fixes

- An APK downloaded for an earlier update was offered for installation again
  once a newer release appeared, so the newer version could not be downloaded.
  Each download now belongs to the update it was started for. It is discarded
  after that version is installed or when another release is offered.
  Installation opens only the APK for the offered update.
- Updates can again be checked, downloaded and installed from the login
  screen before sign-in.
- Phones that kept such an APK from 0.20.3 or earlier need one manual install
  of the fixed release. From that release on, the stale record is cleared on
  start.

## v0.20.3 (Android) - Background notifications on vendor Android ROMs

- ColorOS, OriginOS, HyperOS and EMUI/MagicOS can freeze PI Mobile in the
  background despite its foreground service. Notifications then wait until the
  app is opened again. The app now detects attention it received minutes late
  while kept alive, and tells the user which switch to turn on for their phone.
- On phones known to freeze background apps, Activity explains the setting up
  front. Notices and Me can ask Android for the battery exemption and open the
  app settings.
- Returning from a system dialog now refreshes notification and battery
  state.

## Unreleased - Android companion redesign and session notifications

- Reorganize the Android companion into Sessions, Activity and Me tabs.
  Sessions lists work that needs you first, filters by computer and groups one
  computer's sessions by project. Conversations open over the tabs with
  directional transitions that honor reduced motion.
- Notify the phone when a shared session asks for an approval or an answer,
  finishes or fails. A visible phone shows an in-app toast and an Activity
  badge. A phone in the background shows an Android notification, which opens
  the conversation and disappears once the request is handled anywhere.
- Keep the relay connected in the background with a foreground service. Smart
  (the default) stays connected while shared work runs and for two minutes
  after; the other modes are Always and Off. Nothing arrives after the app is
  swiped away or force-stopped.
- Fix several companion issues:
  - Streaming wrote every loaded message to the phone cache; now it writes only
    the changed ones.
  - Live events stalled while the WebView was hidden; they now keep applying.
  - Network loss showed repeated errors; it now shows as offline state.
  - Share scopes were not localized.
  - Language and theme are now applied before the first paint.
  - Layouts broke on WebViews without `color-mix`.
  - Internal model instructions showed as empty rows.
- The desktop now reads settings once per mobile session-list page instead of
  twice per session.

## Unreleased - Ultra collaboration

- Add Ultra at the end of desktop reasoning controls and in the Android model
  sheet. Save it per session, reset it on model/group changes, and keep Fast
  independent. Running tasks retain their launch configuration.
- Resolve native reasoning independently for the parent and each delegate.
  Reuse background Task workers with proactive parallel-work guidance and an
  explicit native `Task.thinkingLevel` override. Never send `ultra` upstream.
- Preserve active workers during idle parent model changes and retain each
  completed worker's model, group and reasoning in history and resume.

## v0.15.10 - Upstream synchronization

This candidate integrates upstream main through `d96382d74`, including changes
after the stable v0.15.10 release. Workspace, desktop, Rust and Android versions
are aligned; this is a local integration, not a published fork release.

- Upgrade to Pi 0.99.1 with its unified model/account registry, native reasoning
  and output capabilities, image adapter API, and operation usage accounting.
- Add upstream Live Voice conversation and work handoff, including actual
  failure reasons, plus per-session Todo checklists and TodoWrite recovery.
- Improve long-conversation rendering and streaming, browser tab ownership and
  previews, input history, and the native inline reasoning slider.
- Integrate plugin composer/work-panel slots, MCP OAuth and configuration
  fixes, Windows/Portable update handling, and resumable truncated subagent
  reports. Include upstream marketplace ordering and macOS packaging cleanup.
- Preserve MirrorCoding account authorization, catalog-selected protocols,
  model/group selection, main-owned credentials, independent subagent Fast,
  model-change Fast reset, and the solid lightning indicator.
- Keep desktop/Android sharing, four task modes, direct and agent image
  generation, partial-response retention, and explicit continuation. Updates
  and issue feedback continue to target AR307/PI-Desktop.
- Fix integration-specific ESM resource paths, host-local tool lifetime,
  cancelled image download cards, and durable mobile queue message identity.

## v0.15.6-mirrorcoding.1

## Subagents run detached and wake the session

- Let the agent finish its turn while subagents keep working: delegates no
  longer hold the turn open or make the session read busy, so new prompts,
  queued work and Continue stay available.
- Wake the idle session automatically when background subagents finish: one
  queued marker turn delivers every undelivered report exactly once, and
  reports that settle during a busy turn arrive at that turn's boundary.
- Make Stop safe around delegation: stopping a turn (or a fatal turn error)
  no longer kills running subagents — TaskStop and the task card stay the
  explicit cancel — and stopped, aborted or restart-interrupted delegations
  can now be continued with `Task.resume`.
- Show background work while the session is idle: a sidebar status dot and a
  chip above the composer count the subagents still running.

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
