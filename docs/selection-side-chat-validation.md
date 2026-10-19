# Selected references and temporary side chat: local validation

Date: 2026-10-19

## Candidate and delivery scope

- Worktree: D:/PI-Desktop-worktrees/selection-side-chat
- Branch: codex/selection-side-chat
- Base and HEAD: 5f272b38bf540251263623f8b94818545d94f78b
- Candidate: uncommitted working-tree changes on that base, not a release commit.
- The latest fetched origin/main matches the base. No staging, commit, push,
  PR, merge, installer, version bump, server change or production-profile change.
- This is task-candidate evidence, not PR integration or packaged-release QA.

## Observable behavior

1. Selecting main-conversation text offers Add to conversation and Ask in side
   chat. References preserve source identities, Chinese, code and TeX, travel
   with messages, and do not replace the existing draft or send automatically.
2. One temporary child per main conversation shares its actual workspace and
   initially inherits its effective context, model, reasoning and permissions.
   Later configuration, tools, approval, queue and events remain session-bound.
3. Hiding retains the child; closing cancels work and recycles its app-owned
   files. Completed project writes remain. Restart discards stale children
   without replaying tools. Parent history is never copied into child JSONL.
4. The side uses a 360px rendered minimum so the Windows titlebar does not hide
   its tab/close control. Insufficient space uses an overlay. An old 80px saved
   preference remains unchanged; unrelated WorkPanel tabs keep their behavior.

## Main implementation areas

- Shared message references: packages/shared/src/message-quotes.ts and message,
  Agent and IPC contracts.
- Selection, reference chips, child UI and workflow:
  apps/desktop/src/features/chat/{SelectionActions,MessageQuotes,SideChatPane}.tsx,
  selected-quotes.ts, side-chat-service.ts and side-chat-transcript.ts.
- Existing Composer/transcript/store operations now accept the bound session.
  Existing queue, steering, edit/regenerate and Smart Stop carry references.
- Electron orchestration: apps/desktop/electron/main/services/side-chats.ts;
  session/Agent IPC, runtime launch and mobile exclusion.
- Agent runtime: side-chat-context.ts plus runtime/sidecar lifecycle wiring.
  Runtime reconstruction transfers existing entry buffers and compaction rather
  than renumbering child messages or introducing a persistent context cache.
- Host: crates/host-core/src/side_chats.rs and db/side_chat_migration.rs;
  schema 26, unique child ownership, history/search/sync exclusion and cleanup.
- English specification, ADR, E2E scenarios, locales, CHANGELOG and Summary.

## Reproduced defects fixed during acceptance

- Closing a side awaiting Write approval previously hung: cancellation covered
  only selected Host tools. All Host-tool approval waits now register and honor
  cancellation; the pending write never executes after close.
- Configuration-driven runtime reconstruction replaced child IDs with inherited
  IDs, making earlier messages uneditable. The regression failed with
  "Side chat turn is no longer available to restore" before the fix and passes
  with buffer ownership transfer, including memory-only compaction.
- A previously saved compact width rendered a 244px side whose tab controls
  were covered by the Windows titlebar. The side-specific minimum/overlay now
  leaves a visible close control without rewriting that saved preference.

## Executed validation

| Surface | Actual result |
| --- | --- |
| Agent runtime full suite | 105 files; 1466 passed, 1 skipped |
| Side context adapter coverage | 8 tests, included in the runtime suite |
| AgentHost full suite | 4 files; 71 passed |
| Shared reference contract | 2 passed |
| Desktop targeted tests | 8 files; 66 passed |
| Rust Host full suite | 941 passed, 1 ignored |
| Host clippy | Passed, all targets, locked dependencies |
| Workspace dependency builds and Desktop typecheck | Passed |
| Electron Main/preload/renderer production build | Passed; existing bundle-size warning remains |
| Isolated Electron user-path/visual suite | All five acceptance groups passed |
| Configured Biome lint | 125 files passed |
| Style tokens, agent policy, architecture, base ancestry, diff whitespace | Passed |
| Rust formatting for every changed/new Rust file | Passed |
| Whole-repository cargo fmt --check | Not green: existing unchanged formatting in agent_capabilities/tests.rs and db/session_sync_migration.rs; left untouched |

Desktop tests: builtin-commands, composer-draft-cache, composer-smart-stop,
mobile-scope, plan-renderer-flow, session-panes, session-scope, work-panel-tabs.

The Electron test uses a local HTTP provider fixture with real renderer,
preload, Electron Main, Agent runtime and Rust Host. It covers selection across
messages, hidden controls, code/math, keyboard actions, multiple references,
edit/regenerate, immediate steering, actual queue delivery, main/side concurrency,
shared-directory Write with approval, independent model/reasoning, completed
Plan-to-Agent transitions, stop/resend, session/tab/Settings navigation,
dark/light/narrow layouts, close with pending approval or a running delegate,
restart cleanup and compact-width recovery. Screenshots were visually reviewed.

The runtime adapter inspects actual provider payload serialization for inherited
images, compaction, the latest complete reply and completed tool evidence, and
checks that inherited material is not persisted or replayed. These are controlled
provider tests, not certification against production or paid providers.

## Reproduction commands

Use the provisioned Node/pnpm environment and existing dependency links. No
second dependency installation is needed. Commands run from the task worktree.

```powershell
rtk proxy powershell -NoProfile -Command '$env:PI_DESKTOP_HOST_BIN="D:/piformc/target/debug/pi-desktop-host-core.exe"; $env:PI_SELECTION_ELECTRON="D:/PI-Desktop-worktrees/mirrorcoding-account-benefits/apps/desktop/node_modules/electron/dist/electron.exe"; & "C:/Users/x1836/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe" scripts/e2e-selection-side-chat.mjs'
rtk proxy powershell -NoProfile -Command '$env:CARGO_TARGET_DIR="D:/piformc/target"; cargo +1.90.0 test -p host-core --locked'
rtk proxy powershell -NoProfile -Command '$env:CARGO_TARGET_DIR="D:/piformc/target"; cargo +1.90.0 clippy -p host-core --all-targets --locked'
rtk proxy pnpm --filter @pi-desktop/agent-runtime test
rtk proxy pnpm --filter @pi-desktop/agent-host test
rtk proxy pnpm --filter @pi-desktop/desktop typecheck
```

Local build helpers used the existing TypeScript binaries for shared, i18n,
plugin-sdk, plugin-devkit, agent-host, agent-runtime, host-runtime and racp, then
Desktop typecheck. Electron used its resolved production Vite configuration with
emptyOutDir disabled to retain prior generated artifacts rather than delete them.

## Evidence and remaining boundaries

- Final successful Electron evidence:
  C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-vyJn56
- Screenshots include selection-dark.png, quotes-expanded-dark.png,
  side-wide-dark.png, side-model-reasoning.png, side-narrow-light.png,
  side-close-confirm.png and side-compact-preference.png.
- requests.json and desktop.log contain synthetic fixture evidence only.
- Local command logs: C:/Users/x1836/Documents/Codex/selection-*-final.log.
- Main user data and the user's running Desktop instance were not used.
- Not run: full Desktop/all-workspace test suites, paid-provider acceptance,
  macOS/Linux/mobile acceptance, installer/update acceptance or PR integration.
- Native Pi/remote adapters, durable side revisions/forks and app-global voice
  or plugin-composer dispatch are outside this local Desktop feature.
- Before distribution: commit the reviewed task, refresh its base, validate the
  integration candidate and build/test the intended release platforms.

## Combined account-benefits preview - 2026-10-19

The first manual preview omitted the separately committed account-benefits feature
(f08901a5d), which is not in origin/main. Applied that committed implementation
to this request worktree, preserving the side-chat composer and locale changes.
No changes were made to the account-benefits worktree, remote branches or server.

Validation after integration:
- Shared/i18n and dependent TypeScript builds plus Desktop typecheck: passed.
- Production Electron main, preload and renderer build: passed.
- mirrorcoding-benefits.test.mjs: 12 passed.
- Chromium account user paths: passed; screenshots retained under
  .artifacts/account-benefits/1792384242019.
- Real Electron selected-reference/side-chat E2E: all five groups passed;
  evidence: C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-I85SYv.
- Reopened the existing isolated manual-preview profile, preserving login.
  Confirmed the actual main-window subscription control and details render,
  one subscription is present, and the check-in section is visible without
  a displayed error. No real check-in POST or model request was triggered.
- The browser test initially required an explicit existing Playwright path;
  no dependency installation was performed.

This remains an uncommitted local preview, not a published release or PR.

## Side-chat layout regression - 2026-10-19

The old layout failed the new real-Electron assertion before the correction.
The main transcript overlapped its 127px overlay dock by 127px; the side dock
was 163px tall with zero overlap while its transcript still masked that height.
Side toolbar groups differed by 36px vertically. Baseline evidence is retained
at C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-1T73O3.

Removed the side-only in-flow dock, forced toolbar rows and model-label rules.
The side now shares the main surface, spacing, overlay dock and responsive
controls. Fixed signed-in narrow controls overlapping despite reporting zero
scroll overflow; acceptance checks actual button rectangles as well.

Validation after the correction:
- Full selected-reference/side-chat Electron E2E: all five groups passed,
  including expanded/narrow layouts, multiline drafts and dark/light checks.
  Evidence: C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-deP8gA.
- Account user-path acceptance passed, including seven widths from 360 to
  900px for main/side panes in both themes, with non-overlapping controls.
  Evidence: .artifacts/account-benefits/1792385078883.
- Visually reviewed expanded-dark, narrow-light and signed-in composer captures.
- Style-token check, production Electron build and git diff check passed.
- No TypeScript or Rust implementation changed in this correction; unrelated
  backend suites and paid-provider acceptance were not repeated.
- Replaced only the two loaded CSS links in the existing isolated manual
  preview, without renderer reload or Agent restart. Main/side dock overlap
  now both equals the measured 127px height and both toolbar rows align.
  Side session identity and editor drafts remained unchanged. No user message
  content was recorded in test artifacts.

No commit, push, release, server edit or production-profile change.

## Compact reference controls - 2026-10-19

The selection toolbar no longer has an enclosing border, rounded card, padding
or shadow. A flat opaque surface keeps transcript text from showing between
the shared ghost controls, which use the existing 28px control height.
MessageQuotes now renders a borderless chevron/count disclosure, numbered
source labels and a small close icon. Full conversation/message IDs remain
available through the shared tooltip on hover/focus and in stored metadata.
The same component serves main/side drafts and sent references.

Changed implementation: SelectionActions.tsx, MessageQuotes.tsx,
message-quotes.css and packages/i18n/src/locales/selection.ts. No shared
button styles, runtime, Host, storage, permissions or server behavior changed.

Validation:
- The new real-Electron appearance assertion failed against the old build
  (1px enclosing border instead of none). Baseline evidence:
  C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-rfzwkf.
- Shared/dependent TypeScript builds and Desktop typecheck passed.
- Production Electron main/preload/renderer build passed. Existing large-chunk
  warnings remain; no dependencies were installed and output was not cleared.
- Style-token check, focused Biome lint and git diff whitespace check passed.
- Full selected-reference/temporary-side-chat Electron suite passed all five
  groups. Final evidence: C:/Users/x1836/AppData/Local/Temp/pi-selection-side-chat-a11GEr.
- Added user-path checks for compact menu geometry, main/side disclosure,
  source tooltip through keyboard focus, keyboard expansion/removal, draft
  preservation and narrow light-theme layout. Reviewed dark main/side and
  light narrow screenshots, including selection actions and source tooltip.
- The test initially attempted selection inside side replies, which is outside
  the existing feature scope; it now uses main selection to append side quotes.
  An existing retry test raced the renderer and clicked an older reply; it now
  waits for the specific edited reply's control instead of the last DOM button.
  Selection setup also waits for its target to finish scrolling before marking
  the DOM range, so screenshots record the real settled selection position.
- Candidate remains the local uncommitted feature working tree based on
  5f272b38bf540251263623f8b94818545d94f78b, not a committed PR candidate.
  A fresh origin/main fetch confirmed the same base revision.
- Not repeated: unrelated backend suites, paid-provider acceptance, other OS
  acceptance, account-benefit flows or release/installer testing. Shared toolbar
  and backend implementations were not changed by this visual adjustment.
- The already-running manual preview was not reloaded or patched with only
  part of the update: the new component markup requires a renderer reload,
  which would discard in-memory drafts. The completed build is on disk.

No commit, push, release, server modification or user-data cleanup.
