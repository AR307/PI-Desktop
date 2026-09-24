# PI-Desktop MirrorCoding Edition

## 2026-09-21 - Android companion implementation

- Added the MC-team requirements handoff, scoped online-sync domain spec and
  architecture decision. MC retains device/grant metadata; desktop owns
  transcripts, attachments and all task execution.
- Exposed browser-safe RACP client/framing entry points and shared the protocol
  error class between browser and Host. Desktop share UI, scoped relay and the
  React/Capacitor Android implementation are integrated in follow-up commits.

### Desktop sync implementation

- Added opt-in project/session sharing, centered pairing dialogs and the account
  page's mobile device manager. Main owns the outbound MC relay; the restricted
  mobile peer checks current sharing scope for history, commands and attachments.
- Reused AgentHost queues, permission/plan approvals and questions. Mobile Stop
  uses the same immediate interruption path as the desktop composer. Client
  message IDs remain stable through the Rust-backed queue and process restart.
- Reused ImageService for mobile generation and result downloads. Admission now
  acknowledges only after parameter validation and user-message persistence so
  an invalid image request retains the mobile draft and reference images.
- Kept attachment access tied to explicit session messages and chunked transfer.
  Session history uses Rust's bounded query instead of loading every message.
- AgentHost 26 tests, host ports 4 tests, Rust queue 10 tests, shared 876 tests,
  RACP 21 tests and i18n 25 tests passed. Desktop production build, typecheck,
  repository lint and Rust formatting passed; Clippy completed with one existing
  unrelated `user_skills.rs` warning.
- Real isolated Electron/mobile browser flows have exercised pairing, scope
  isolation, history, continuation, queues, immediate stop, questions, approval,
  photos, reconnect, image generation, restart and revocation. Final candidate
  counts and native Android acceptance are recorded after the remaining checks.

### Android client implementation

- Added a React/Capacitor 8 application targeting Android SDK 36 (minimum 24),
  using PI's design tokens, launcher assets, English/Chinese and light/dark UI.
- Native secure storage retains mobile credentials without storing passwords.
  Views cover pairing, shared work, history, tools, plans, questions, approvals,
  queue state, chat continuation and desktop-selected image generation.
- System file picking, chunked upload, image preview, save/share and reference
  reuse work through the same scoped desktop connection. Drafts survive network
  reconnect and foreground return; uncertain submissions are checked on desktop.
- Fixed browser fetch binding, transient send acknowledgement recovery, live
  mode updates, snapshot/stream merging, Android Back and persistent send errors
  found while exercising actual interfaces. No separate mobile agent exists.
- Mobile typecheck and five service/user-path tests passed. Scoped Biome lint
  checked 21 mobile and locale files. Native APK runs have already exercised
  login, pairing, continuation, keyboard layout, foreground restore, native file
  picking, image generation, preview, share and reference reuse. Final native
  restart/visual evidence and the installable package are recorded next.

### Android visual refinement

- Native acceptance on Android 15 / WebView 124 passed 19 checks, including real
  secure credential recovery after force-stop/relaunch, native picker and share,
  reference generation, foreground reconnect and Back navigation.
- Screenshot review found light system-bar gutters around the dark application.
  The existing Capacitor SystemBars API now follows the chosen theme, with a
  small Android appearance bridge for older WebViews' native inset background.
  Removed the conflicting legacy fullscreen keyboard-resize option and use
  Capacitor's safe-area values. Final native validation reruns this refinement.

### Plan approval recovery

- The expanded real desktop/phone scenario reproduced a pending plan disappearing
  when its planning turn finished. AgentHost now closes only turn-bound tool
  approvals at turn completion and restores durable Plan/Goal approvals from
  Rust during snapshots for phone reconnect or AgentHost recreation while the
  Rust host remains available. Full desktop restart retains the existing Rust
  behavior of marking pending proposals interrupted; it does not leave those
  proposals available for approval.
- Added regressions that fail on the previous lifecycle and pass after the fix:
  32 AgentHost/approval checks passed, followed by all 21 RACP checks. AgentHost,
  RACP and Electron were rebuilt before rerunning the visible approval flow.

- Native screenshot review also caught a launch-theme action bar appearing when
  Android edge-to-edge initialization ran before Capacitor applied NoActionBar.
  Initialization now runs after the bridge activity's theme setup.

### Final companion acceptance and delivery

- Executable candidate `d2e5917ef4ac8558e40196e9f4446c1f1278249c`, base main
  `996922fa729870e88ed9e439aa6959e388c12f91`; refreshed origin/main is unchanged.
- Actual isolated Electron/touch-browser acceptance passed all 41 checks without
  renderer/cleanup errors. Actual Android 15/WebView 124 acceptance passed all
  19 checks, including native secure storage, picker/share, keyboard, reference
  generation and process restart. Settled EN/ZH light/dark screenshots were
  reviewed, with the corrected native header and system bars.
- Rebuilt the official-origin preview APK, installed it and verified the native
  login screen with no acceptance hooks and no production login submission.
  Package and reports live under `D:/piformc-artifacts/mobile-companion`.
- Workspace package builds, desktop/mobile typechecks and builds, relevant
  tests and lint passed as detailed in `docs/mobile-companion-delivery.md`.
  MC-team integration, physical-device coverage and production deployment remain
  external acceptance. All implementation commits stay local in this worktree.

## Project and source baseline

This branch starts from upstream PI-Desktop `920b12b8e` (0.15.6, 2026-09-24)
and adds MirrorCoding support without replacing upstream agent, image, plan, or
remote-host implementations. The desktop application remains an Electron
renderer plus Electron main process, Rust `host-core` persistence/runtime, and
Node agent sidecar. The Android companion will be added as a separate
Capacitor application after the desktop relay contracts are in place.

## Architecture map

- `apps/desktop/src`: React renderer, chat composer, model/mode controls, plans,
  images, settings, and work panels.
- `apps/desktop/electron/main`: Electron orchestration, IPC registration,
  provider/runtime bridges, image service, and remote-host lifecycle.
- `crates/host-core`: authoritative persistence, provider records, sessions,
  plans, and RPC contracts.
- `packages/agent-runtime`: Node sidecar agent execution, tools, image
  generation, and provider adapters.
- `packages/shared`: cross-process protocol and typed data contracts.
- `apps/mobile` (planned): Capacitor Android shell for scoped MirrorCoding
  session sync and continuation.

## Current baseline

- Source: `origin/main` and `upstream/main` at `920b12b8e`.
- Branch: `codex/mirrorcoding-new-baseline`.
- Remotes: `origin` is `AR307/PI-Desktop`; `upstream` is
  `vastsa/PI-Desktop`; `legacy` is the old local repository used only for
  audited comparisons.
- Upstream already provides generic image generation, image attachments and
  persistence, Plan/Goal/AskTool workflows, reasoning-level controls, and the
  RACP remote-host foundation.

## Migration status

1. MirrorCoding account lifecycle now uses the fixed `pi-desktop` PKCE contract,
   safeStorage, single-flight access-token refresh, revocation retry records,
   catalog parsing, managed-provider sync, and a localhost request relay.
2. The relay keeps MirrorCoding access/refresh tokens in Electron main and gives
   the sidecar only a per-session local key, selected route, and group header.
3. MirrorCoding image catalog capabilities and image-generation/edit relay
   bindings are now parsed and routed through the same local relay. Reference
   images use the documented JSON data-URL shape, while credentials remain in
   Electron main.
4. Mobile-sync shared contracts, scoped desktop relay service, pairing UI, and
   attachment/image forwarding are implemented. Android client and mobile
   configuration controls remain follow-up work.
5. Window sizing, panel dragging, and Plan prompt-question behavior have been
   migrated with focused regression coverage.

See `docs/mirrorcoding-v2-migration-audit.md` for evidence, boundaries, and
the staged acceptance plan.

## Mobile sync contract

The mobile-sync contract adds restricted project/session sharing types and IPC
channel names. `MobileDeviceCredentials` encrypts the MC desktop device
identity with Electron `safeStorage` and writes it atomically. The optional
`MobileSyncService` IPC seam validates pairing, cancellation, refresh, and
grant-revocation inputs without changing the existing remote-host protocol.

The relay and catalog image capability layer are present. Desktop scope checks
cover history, continuation, approvals, attachments and image jobs; Android
client and MC service integration are migrated in the next commits.

## Latest implementation update

- Added strict parsing for MirrorCoding image generation/edit capabilities,
  including supported sizes, qualities, aspect ratios, reference paths, and
  maximum output count.
- Added image route bindings to managed providers and a main-process relay path
  for JSON generation and reference-image requests.
- Added MirrorCoding image-model filtering to chat/default-model selection so a
  model is only offered for a chat request when the catalog declares a chat
  route.
## Validation

The shared, agent-runtime, and desktop TypeScript builds pass in this worktree.
The workspace currently runs Node `22.12.0`; the repository declares
`>=22.19.0`, so final release validation must rerun under a supported Node
runtime. Rust validation is still pending.

The image contract now includes a main-process generation task, local
attachment persistence, and image-generation IPC channels. The desktop image
UI and agent tools remain the next migration stage.
<!--
## Where future improvements belong

| Requested change | Primary implementation area | Representative usage to verify |
| --- | --- | --- |
| Chat layout, input, rendering, navigation | Renderer `features/`, `components/`, `stores/slices/`, and `styles/` | Send a prompt, read a streaming response, switch sessions, resize the window. |
| Provider connectivity or resilience during network fluctuations | Agent `provider-retry.ts`, `provider-transport-recovery.ts`, `node-proxy.ts`, and `provider-binding.ts` | Temporary disconnect/rate limit during a real turn; observe recovery and stop behavior. |
| Agent context, instructions, compaction, delegation | `packages/agent-runtime/src/` | Continue a long conversation, invoke a tool, and follow a delegated task. |
| Local files, shell execution, persistence | Rust `tools/`, `sessions.rs`, `transcripts.rs`, and `db/`, with corresponding shared contracts | Open a project, execute the affected operation, reopen the session. |
| Plugins, Skills, or MCP | Existing desktop domain services, Rust plugin modules, SDK, and runtime bridges | Install/enable the affected capability and invoke it from its actual UI or agent entry. |
| Remote workspaces | Desktop `main/remote/`, `apps/pi-host/`, `packages/racp/`, and shared runtime | Connect to a host, run a task, disconnect/reconnect, inspect its conversation. |

Source inspection already found provider retry and transport-rebuild modules;
network recovery work should start there. Their presence is not proof that all
failure scenarios work. No network-failure experiment was run during initial
onboarding; MirrorCoding acceptance below records the later local fault checks.

The renderer already has feature modules and store slices. Several backend
files remain large: `rpc/mod.rs` has 8,679 lines, agent `runtime.ts` 7,683,
`sessions.rs` 6,131, and desktop `plugin-runtime.ts` 5,655 at the reviewed
revision, including inline tests where present. These are navigation and
maintenance hotspots, not measured performance defects. Improve the module
needed by an actual request rather than starting a repository-wide rewrite.

## Initial onboarding verification snapshot

- Full, non-shallow clone completed; source revision and workspace manifests
  checked. The original `main` checkout had no local modifications.
- Default shell Node is `22.12.0`, below the declared requirement. An existing
  bundled Node `24.19.0` was located, and pnpm `11.18.0` successfully executed
  with that Node selected for the child shell. No global toolchain was changed.
- Rust/cargo `1.86.0`, the Windows MSVC target, and Visual Studio 2022 C++ tools
  were detected. Dependency compatibility is not established by detection.
- Dependencies have not been installed. Application compilation, desktop
  launch, visual interaction, E2E, remote connection, and real provider calls
  have not been run. This is an architecture baseline, not runtime acceptance.
- Existing user-path checks include `test:e2e:boot`, `test:e2e:transcript`,
  `test:e2e:composer-paste`, `test:e2e:subagents`, and `test:e2e:remote-host`.
  Select checks around the requested behavior when implementation starts.
- Repository workflow documentation has drift: root `AGENTS.md` forbids local
  main as an integration branch, while parts of `docs/spec/06-delivery/` still
  describe local-main integration. This onboarding follows root policy and
  keeps its documentation on `docs/architecture-onboarding` in a dedicated
  worktree. No delivery-policy files were rewritten.

## Update log

### 2026-09-21 - PI image-generation handoff and desktop foundation

- Scoped the implementation to PI-Desktop. The MirrorCoding server is treated
  as an external dependency for this task.
- Added shared image-generation capability, request, result, and per-session
  selection contracts. MirrorCoding providers now retain image capabilities
  alongside their existing chat routes, and the Composer model projection can
  distinguish chat-capable and image-capable models.
- Added [MirrorCoding image-generation requirements](docs/mirrorcoding-image-generation-requirements.md)
  for the separate service team. It defines the catalog fields, authorization
  paths, JSON/multipart requests, response shapes, and local fixture coverage.
- No credentials, production configuration, or service deployment were used.

### 2026-09-21 - Main-process image relay and durable generation

- Added a main-process-only image relay. It validates the latest account catalog,
  URL-encodes the selected group, keeps Bearer credentials out of renderer and
  sidecar requests, and sends either JSON generations or multipart edits.
- Added image IPC for generation and cancellation. Base64 and downloadable URL
  results are stored as content-addressed local attachments and appended to the
  current session as an assistant image message with the selected model, group,
  multiplier, and declared options.
- Added shared contract tests for option filtering, reference support, count
  limits, and capability parsing. Desktop typecheck passed after the relay and
  IPC wiring.

### 2026-09-20 - Work-panel dragging and browser resize

- Moved the tab-strip drag exclusion onto individual tabs, leaving header
  whitespace available to the native window while keeping controls clickable.
- Reproduced Chromium restoring a 360px capture viewport after the native
  browser had already grown to 750px. BrowserPane now queues screenshot work
  and applies the latest requested bounds after capture, including failures.
  Both the screenshot API and raw CDP capture share that lifecycle.
- Added a real Electron regression runner with a loopback responsive fixture,
  isolated profiles, retained geometry evidence and guest screenshots. It covers
  eight capture/resize overlaps, concurrent captures, capture failure recovery,
  panel maximize/restore, native window resizing, collapse/reopen and tab controls.
- Desktop build, typecheck, lint and 79 relevant existing tests passed. The
  Electron runner passed 16 geometry scenarios and tab control interactions.
  No Rust or provider changes were made; no paid API or account was used.
- Native mouse double-click on the fixed header invoked OS maximize. The
  automation drag gesture did not move either the panel header or the unchanged
  chat header, so it does not establish a successful OS drag. The built fixed
  window remains open for the user's direct drag check.
- Implementation stays in `codex/window-drag-browser-resize`, based on the
  existing MirrorCoding feature and refreshed `origin/main` at `996922fa`.
  Delivery is local only; application profiles and artifacts remain outside Git.
- Candidate `60bd65c2`, refreshed against base `996922fa`, passed the complete
  browser-layout runner on Windows / Electron 43.6.0. Visual review confirmed
  one-column 360px and three-column 650px/825px pages. Evidence is retained in
  `D:/piformc-artifacts/window-layout/candidate`; this record changes no code.

### 2026-09-20 - MirrorCoding account and model usage

- Added main-owned PKCE account lifecycle, OS-encrypted credentials, coalesced
  catalog/refresh work, revoke-only retry records and the loopback streaming relay
  under `apps/desktop/electron/main/mirrorcoding/`.
- Rust projects account/group identities into existing managed provider rows;
  shared contracts and host protocol are version 12. No database migration was
  added, and disabled historical providers retain session references.
- Added Settings Account, optional first-launch welcome, explicit default
  selection, and model-then-group menu with actual multipliers/dynamic billing.
  Welcome and confirmation dialogs use viewport centering, focus containment and
  narrow-window sizing. Existing manual providers remain separate.
- Resolved native model metadata/protocols and verified actual reasoning effort,
  Anthropic budget and Gemini thinking requests through the real desktop. Added
  request-scoped Google SDK transport support after observing its rejection of
  custom fetch, and prevented automatic MirrorCoding replay after partial output.
- Actual Electron + local MirrorCoding browser consent + controlled upstream
  acceptance passed authorization, skip/restart, selection, native streams/tools,
  inherited subagents, auxiliary calls, pre-output retries and active continuation.
  HTTP/Rust recovery acceptance passed 27 account/relay fault scenarios. Targeted
  agent-runtime tests passed 91 cases; Rust provider tests passed 39 cases.
- Added the feature specification, ADR 0299, unreleased changelog, and repeatable
  local acceptance instructions. Production-domain authorization, real paid model
  behavior, OS default-browser association and installer packaging remain outside
  the completed local fixture verification.
- Delivery remains local commits only. Test profiles, screenshots, logs and
  generated credentials stay outside Git; no service is deployed or pushed.

### 2026-09-20 - MirrorCoding visual and delivery verification

- Centered the welcome and running-task confirmation against the viewport, with
  focus containment and narrow-window sizing. Changed group rows to place the
  name/rate on the first line, with description and reasoning on separate lines.
- Actual desktop acceptance now includes direct welcome login, skip/settings
  login, restart, group keyboard navigation, dismissing the active-task dialog,
  and confirmed logout while an ordinary provider continues its own request.
- JS workspace build, desktop typecheck, lint, Rust formatting/build and clippy
  succeeded. Clippy retains an existing `useless_format` warning in
  `crates/host-core/src/user_skills.rs:921`; the desktop bundler reports large
  chunks. Desktop targeted tests passed 123 cases, shared tests 870, i18n 25;
  the final menu-only rerun passed 23 cases after the layout change.
- Host-runtime tests passed 28 of 29. The existing launch-resolver test expects
  `/data/scratch/s1` while Node's `path.join` produces Windows separators.
  Both the resolver and that test are unchanged from `origin/main`; this is a
  pre-existing Windows test portability issue, not a MirrorCoding runtime failure.
- Refreshed `origin/main` before candidate preparation; it remains
  `996922fa729870e88ed9e439aa6959e388c12f91`. No main checkout, server deployment,
  real account, paid provider, or published branch was used for acceptance.
- Final task candidate `4f22ee42a88d1e8695bd25173745ff30306bb572` includes that
  base. Its Electron/browser suite passed all 47 checks and its HTTP/Rust
  recovery suite passed all 27 checks. Local artifacts are retained under
  `acceptance-candidate` and `recovery-candidate` outside this worktree. Screenshots
  confirm centered dialogs in both themes and readable model/group rows.
- Validation environment: Windows, Node 24.19.0, pnpm 11.18.0, Rust 1.90.0,
  Electron 43.6.0, headed Edge, isolated Docker MirrorCoding authorization, and
  controlled HTTP/SSE model responses. The following documentation-only commit
  records results; it does not change the tested executable source.

### 2026-09-20 - Initial architecture onboarding

- Cloned the requested GitHub fork and retained its full history.
- Added this source-backed map of packages, process boundaries, prompt flow,
  development commands, and concrete improvement entry points.
- Recorded actual toolchain checks and the untested runtime scope.
- Documentation-only change; no application behavior changed. Delivery is a
  local commit only, with no push or pull request.
-->


### 2026-09-21 - Direct and agent image generation

- Completed a separate image task path: Node uses pi ImagesProvider; main owns
  MirrorCoding loopback authentication, job cancellation and attachment handling;
  Rust stores per-session settings and image transcript content blocks.
- Added the split mode picker, capability-specific model/group choices, declared
  image parameters, durable cards, preview/save/reference reuse and URL retries.
- Added ListImageModels and GenerateImage as runtime tools, with read-only
  planning behavior and cancellation across the existing host-local tool bridge.
- The desktop remains based on the committed account/window fixes and current
  origin/main. Work is confined to codex/image-generation; no MirrorCoding
  server repository, production profile or deployed domain is modified.
- Added the server handoff, feature specification, architecture decision and a
  real isolated Electron protocol acceptance driver. Initial desktop runs proved
  direct generation, all three reference routes, autonomous tool generation,
  persistence, anonymous download retry, cancellation and refresh. They exposed
  a zero message-window request and missing mode-menu arrow handling, both fixed.
- JS builds, desktop typecheck, lint, 876 shared tests, 25 i18n tests and 72 Rust
  session tests passed before candidate preparation. Candidate verification and
  final visual review are recorded separately after execution.
- The expanded Electron run passed 44 checks including permission changes and
  ordinary chat after sign-out. A follow-up download-cancellation scenario
  reproduced a completed-status bug; cancellation now retains pending downloads
  and the prompt instead of reporting success. The final candidate reruns it.
- The complete workspace JS build, final desktop typecheck, lint and Rust format
  check passed. Targeted agent runtime tests passed 218 cases and desktop image/
  model/transcript tests passed 47 cases. Host-runtime retains the unchanged
  Windows separator assertion described above (28 of 29 pass); no installer or
  paid/deployed MirrorCoding acceptance is claimed.
- The older delivery workflow document still describes local-main integration.
  This task follows the supplied root policy and local-only delivery instruction:
  validation and commits stay in the dedicated task worktree.
- Candidate 699f709c proved that stopping an image download preserves its prompt
  and aborted status, then exposed the empty-text image error card being hidden
  by compact transcript grouping. Image results now remain visible outside that
  disclosure so the retained download can be retried immediately.
- The same scenario also caught live message completion discarding empty-text
  image failures before rendering. Terminal projection now retains image result
  rows, including cancelled results with pending downloads.
- Candidate 071ca66f passed all 46 Electron checks with no live or shutdown
  renderer errors. Visual capture waits for the sidebar transition and completes
  notification dismissal before recording the narrow layout.

### 2026-09-21 - Image generation final acceptance and handoff

- Task candidate: `28a74eac1ba8f6ccb13b427ead124e1c7c964741`; base main:
  `996922fa729870e88ed9e439aa6959e388c12f91`. The branch includes that base and
  remains local in the dedicated `codex/image-generation` worktree.
- `apps/desktop/test/e2e/images/acceptance.mjs` passed all 46 checks using actual
  Electron, Rust, Node sidecar, an isolated profile and controlled local HTTP/SSE
  image/chat endpoints. Both live and shutdown renderer error lists are empty.
  The run covers direct and agent generation, declared parameters, reference
  routes, cancellation, download-only retry, account/group recovery, persistence,
  planning restrictions and ordinary provider use after MirrorCoding logout.
- Reviewed the settled Chinese dark and English light 600px views, the regular
  1200px layout and centered preview. Controls and image cards remain usable.
  Screenshots, request evidence and the report are in
  `D:/piformc-artifacts/images/acceptance-final`, outside version control.
- The final desktop build, typecheck and lint passed. Additional transcript
  verification passed 28 turn/process checks and 13 session-history checks.
  Earlier workspace/Rust/shared/runtime checks and the unchanged Windows
  host-runtime test limitation are recorded above.
- `docs/mirrorcoding-image-generation-requirements.md` is the server-team handoff.
  It defines the exact catalog, authorization, reference normalization, response
  and acceptance contract used by PI. MirrorCoding implementation/deployment,
  paid upstream tests and installer packaging remain separate delivery work.
  This documentation-only record changes no tested application source.

### 2026-09-21 - Mobile interface and per-session controls

- Reworked the React/Capacitor companion around a compact conversation header,
  auto-growing composer, shared bottom-sheet/full-screen/confirmation surfaces,
  Android Back handling, safe areas, reduced motion and stable transcript
  scrolling. Account, pairing, project and session views now use the same visual
  hierarchy and PI light/dark tokens.
- Added phone-side Agent, Plan, Goal and Image selection; searchable desktop chat
  and image catalogs; MirrorCoding model-to-group selection with actual ratios;
  reasoning levels; and service-declared image size, ratio, quality and count.
  Chat and image choices remain separate. Model changes visibly reset unsupported
  parameters and clamp image count; invalid reference images stay in the draft
  with an actionable error.
- Added scoped `session/modelCatalog` and `session/configure` mobile operations.
  Electron builds display-only choices from usable desktop providers and the
  image service, while Rust remains authoritative for session state. A running
  task keeps its captured configuration; model/group/reasoning changes are saved
  for the next turn, while mode changes remain blocked during work or approval.
- The controlled Electron/mobile-browser acceptance passed all 59 checks with no
  renderer or cleanup errors. It exercised the real desktop, Rust host, Node
  runtime and phone UI across pairing, history paging, streaming, queued turns,
  questions, approvals, attachments, reconnect, all four modes, model groups,
  reasoning, cross-model image-option cleanup, revocation and 320px Chinese
  light-mode layouts.
  Reviewed screenshots show no overlap, clipping or horizontal overflow.
- Workspace JS build, desktop/mobile typechecks and builds, repository lint,
  shared/i18n/AgentHost/RACP/mobile/catalog tests, Rust formatting and relevant
  configuration tests passed. Clippy retains the existing `user_skills.rs`
  warning. Full host-core and pi-host suites retain only their existing Windows
  path/permission assertions; the changed configuration tests pass.
- Capacitor Android sync and Gradle `assembleDebug` succeeded. The installable
  debug APK is at
  `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (about 5.35 MiB).
  A new native-emulator interaction run could not start because local WHPX
  reported too many emulator instances; no AVD or lock file was removed. The
  earlier companion native run remains baseline evidence, not a claim that this
  UI revision was re-executed on Android.
- Normalized the migrated mobile configuration sheet so image-mode controls
  remain cleanly formatted and pass repository whitespace checks.
- Added the shared mobile, image, and sync namespaces to the Portuguese locale
  fallback so every shipped locale satisfies the catalog contract.
- Aligned the desktop pairing dialog with the normalized MirrorCoding account
  display-name field used by the current account state.
- Fixed local image-tool cancellation to notify Host after aborting the local
  controller, keeping desktop and mobile cancellation state consistent.
- Made the launch-resolver scratch-directory assertion use the platform path
  helper so the host-runtime suite passes on Windows as well as POSIX systems.
- Restored the missing host-core import for the MirrorCoding provider metadata
  used by managed-provider synchronization.
- Removed a duplicate mobile IPC registration left by the relay merge; desktop
  startup now installs each mobile channel exactly once.
- Added a host-core contract test for the MirrorCoding group/model sync payload
  used by the desktop account catalog refresh.
- Aligned Rust image-route deserialization with the shared route object shape so
  image-capable groups no longer fail whole-catalog synchronization.
- Preserved the catalog image-model capability map in Rust Provider reads so
  desktop and mobile image pickers can see declared generation/edit parameters.
- Restored the desktop two-level MirrorCoding picker: model IDs are deduplicated
  across groups, then the user chooses the concrete group and multiplier.
- Kept the pending model ID while entering the group submenu so the available
  group rows are retained during the selection transition.
- Allowed logged-in MirrorCoding image Providers to submit without exposing a
  renderer-side secret; their credentials remain main-process owned.

## Release Candidate

- Windows installer: apps/desktop/release/PI-Desktop-Setup-0.15.6.exe.
- Windows portable ZIP: apps/desktop/release/PI-Desktop-Portable-0.15.6.zip.
- Android release APK: apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk.
- Release validation used Node 24.19.0, Rust 1.90.0, Java 21 and the single
  PiMobileQA / emulator-5554 instance. The APK is unsigned because no release
  keystore is configured in this workspace.
