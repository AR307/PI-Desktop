# Upstream synchronization: 2026-10-19

## Scope and source revisions

- Original upstream: vastsa/PI-Desktop, upstream/main.
- Upstream revision: 589e5803a7a9f4ebf7ec1e8849c43e44b4a198f7,
  v0.21.0-beta.4. This is a beta, not a newly declared stable release.
- Fork base: AR307/PI-Desktop origin/main,
  5f272b38bf540251263623f8b94818545d94f78b.
- Both heads were fetched again before delivery; neither changed.
- Incoming upstream history: 99 commits absent from the fork base.
- Request branch: codex/sync-upstream-20261019.
- Request worktree: D:/PI-Desktop-worktrees/sync-upstream-20261019.

The integration preserves upstream ancestry rather than copying an upstream
snapshot over the fork. The existing selection-side-chat worktree has the same
fork base and contains 94 tracked changes plus 35 untracked feature files.
Those changes were copied and three-way integrated into this request worktree;
the source worktree, its branch and its drafts were not modified. The account
feature changes were not cherry-picked a second time.

The original 48 merge conflicts and seven local-feature application conflicts
were resolved. No conflict markers or unresolved index entries remain.
No primary-checkout modification, remote push, PR update, main merge, release,
server change, production-account test or user-preview restart is included.

## Preserved fork behavior and integration choices

| Surface | Integration decision |
| --- | --- |
| Selected references and side chat | Preserve source-aware references, isolated composer state, effective inherited context, temporary Host ownership, approval and cancellation, compact buttons and narrow overlay. |
| Account benefits | Preserve signed-in quota bar, active subscription details and manual check-in, including permission/unavailable states. Server-side availability is still an external dependency. |
| Mobile and branding | Preserve fork mobile code, synchronization actions and supplied branding. Reconnect mobile pairing in upstream sidebar action models. No mobile release or device certification is claimed. |
| Image generation | Preserve account model discovery and Agent-initiated generation without manual Image-mode setup. Retain Image as the fourth option in the upstream single-chip mode menu. |
| Sidebar | Adopt upstream nested Copy/Git/danger menus and session activity behavior, retaining mobile actions and native clipboard IPC. |
| WorkPanel | Adopt preferred/yielded width semantics; preserve side-chat minimum and overlay. Constraint-driven compression does not become a saved preference. |
| Runtime and transcripts | Preserve turn configuration capture, reference metadata, image rendering and side-chat runtime reconstruction; also record upstream turn starts and use transcript-rewrite guards. |
| Session reuse | Exclude both scheduled automation and temporary side chats from ordinary reusable sessions. |
| Storage | Adopt upstream junction/directory-symlink/file handling and preserve fork maintenance. Host/shared schema agree on version 26; existing conversation records are not rewritten. |

## Integration regressions reproduced and fixed

### Detached background commands in temporary side chats

The new upstream background-command registry has a process-wide lifetime.
Simply merging it with temporary side chats allowed both composers to show the
same task and allowed a detached child command to survive explicit child close.
The new real-Host regression failed before the integration fix.

Each composer now subscribes to its own session's tasks. Explicit close checks
for pending child commands, asks for confirmation even when the foreground turn
is idle, and waits for those commands to finish before temporary-record cleanup.
Canceling the confirmation keeps the child and command alive. Closing the child
does not stop the parent's commands or revert completed project writes.

Ordinary turn cancellation is intentionally different: detached Bash survives
it, while foreground tools and permission waits, including Write/Edit, retain
cancellation. Already-finished failed commands do not block child closure.

### Mode-menu keyboard interaction

The upstream chip/menu replacement was combined with the fork's Image option.
Browser acceptance exposed missing arrow-key navigation. The mode menu now
handles ArrowUp/ArrowDown/Home/End without changing the selected mode until the
user activates an item. Escape closes without selecting another mode.

### Acceptance-driver adjustments

Tests use the new menu instead of the old cycle/split-chip selectors. The native
pointer test first hovers the sidebar row so its hover-only More button is
actionable. Keyboard acceptance waits until the menu has completed its existing
focus initialization. Image-reference input uses a normal text-insertion event
instead of racing character-by-character input against token caret restoration.
These changes retain observable behavior assertions; they do not add production
fallbacks or remove failing checks.

## Executed candidate validation

Tests use the request worktree's executable tree, not the primary checkout.
Third-party dependencies, Electron and compatible caches are reused from the
existing development environment; isolated profiles, ports and local HTTP
fixtures are used. No paid provider or production account is contacted.

| Validation | Actual result |
| --- | --- |
| Workspace TypeScript builds | Shared, i18n, Plugin SDK/DevKit, Agent Host/runtime, Host runtime, RACP and Voice runtime passed. |
| Desktop typecheck | Passed. |
| Electron main/preload/renderer build | Passed with existing bundle-size warnings; output cleaning disabled to preserve files. |
| Rust 1.90 build, fmt check, clippy | Passed, including the final tool-cancellation change. Default Rust 1.86 is not used for this candidate. |
| Targeted Desktop tests | 238 passed, zero failures/skips. |
| Shared quote/protocol tests | 22 passed. |
| Targeted runtime tests | 414 passed across three files. |
| Host side-chat/schema tests | 2 passed. |
| Host background-task tests | 4 passed. |
| Real Host background-command stress | Passed: 10 tasks and approximately 202 MB of generated output; bounded output and detached lifetime checks. |
| Real Host child-background cleanup | Failed before the fix; passed after it, preserving the parent's task and ordinary-turn detached behavior. |
| Selected-reference/side-chat Electron acceptance | Five scenario groups passed, including native sidebar submenu/mobile-action presence, quotations, tools/approval, model/reasoning, independent running sessions, child background close/cancel, queued/steered edits, narrow layout and restart cleanup. |
| Account image Electron acceptance | 49 checks passed, zero uncaught renderer errors; fresh OAuth, automatic Agent generation, manual options/references, stop/retry, auth refresh, restart, planning permissions, logout, keyboard and narrow themes. |
| Benefits browser-to-IPC-handler-to-local-HTTP acceptance | Passed quota/check-in, expiry, duplicate POST prevention, auth refresh, permissions/offline states and signed-in main/side layout across seven widths and both themes. Native transport and live server parity are not claimed by this suite. |
| Style tokens and agent-policy sync | Passed. |
| Targeted Biome lint | Passed for three files included by the repository configuration; not a claim of full repository lint. |

The initial validation was on the uncommitted merge tree (HEAD still reported
the fork base). In particular, the benefits harness's recorded candidate SHA
is that base; it must not be described as a committed build of the base alone.
Final post-commit candidate checks are recorded separately in the external
validation log directory. This is task-candidate QA, not PR integration QA.

### Local evidence

- Build/test logs: C:/Users/x1836/Documents/Codex/pi-sync-20261019/.
- Final side-chat Electron evidence:
  C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-2gcWjB/.
- Final image Electron evidence: .artifacts/images-1792390279041/.
- Benefits acceptance: .artifacts/account-benefits/1792388821768/.
- Final Host child-background evidence:
  C:/Users/x1836/AppData/Local/Temp/pi-side-background-Rx9p5b/.

Visually inspected the native sidebar Copy submenu with the retained mobile
action, separate main/side background-task bars, wide/narrow side layouts and
dark/light image layouts. Screenshots and isolated profiles are retained locally
and are not committed. Test fixture credentials are synthetic.

## Delivery limits

This work prepares the synchronized source and local executable candidate on
the request branch. It does not replace the running preview or update either
local main or remote main. The user's previous feature worktree is unchanged.

Not executed: macOS/Linux builds, Android build/install/device testing, signed
Windows installer/update testing, live-provider certification, full monorepo
test suite or PR merge-candidate validation. No release asset is produced or
published. These are release/landing follow-ups, not claimed pass results.

Before a later PR or release, fetch both remotes again, incorporate any newer
main changes in this request worktree, run the relevant candidate validation,
and follow the repository's PR integration gates. Do not merge into local main
as a temporary test environment and do not clean other worktrees.
