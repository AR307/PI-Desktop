# 04. E2E Test Plan

## 1. Goals

- Document every user-visible and protocol-visible behavior that MVP must verify.
- Provide a scenario catalog that maps to acceptance criteria (A–H) and milestones (M1–M6).
- Serve as the traceability backbone: scenario ID ↔ acceptance criterion ↔ spec.
- Define the required E2E gate for code-bearing task candidates containing the
  latest `origin/main`, before the pull request; do not merge into local `main`.
- Keep validation evidence tied to the commit the gate ran on, plus any later
  commit that changes the landed executable content.

## Scenario catalogs

Scenarios are grouped by product domain. Add a new scenario to the file
that owns its domain; keep its ID unique across all files.

| Domain | Catalog |
|---|---|
| Release, Platform, and Storage | [`e2e/release-and-platform.md`](e2e/release-and-platform.md) |
| Providers and Models | [`e2e/providers-and-models.md`](e2e/providers-and-models.md) |
| Conversation and Sessions | [`e2e/conversation.md`](e2e/conversation.md) |
| Tools, Permissions, and Workspace | [`e2e/tools-and-workspace.md`](e2e/tools-and-workspace.md) |
| Plugins and Extensions | [`e2e/plugins-and-extensions.md`](e2e/plugins-and-extensions.md) |
| Plans, Goals, Modes, and Automations | [`e2e/plans-goals-automation.md`](e2e/plans-goals-automation.md) |
| UI Shell | [`e2e/ui-shell.md`](e2e/ui-shell.md) |
| Live Sessions and Remote Control | [`e2e/live-and-remote.md`](e2e/live-and-remote.md) |

---

## 2. Non-goals

- Full UI-driven automated coverage; protocol and source-contract automation is
  active while the broader desktop suite remains planned.
- General performance / stress testing (post-MVP); bounded regression checks
  for desktop responsiveness are covered by the relevant functional scenarios.
- Native Windows/Linux release qualification (published artifacts exist; native
  qualification gaps remain documented).
- Hostile-plugin sandbox scenarios. Publisher provenance and the marketplace
  download boundary are now in scope (E2E-024R through E2E-024V); basic
  browse/install/update flows were already part of the catalog.
- Remote Gateway / browser control remains out of scope (ADR 0004 / baseline
  #20); the bounded local loopback MCP control plane is covered by E2E-220.

---

## 3. Test Pyramid

```
        ╱  E2E  ╲           — few, high-value, cross-system
       ╱ Integration ╲      — IPC/RPC contracts, host↔renderer
      ╱    Unit       ╲     — per-module, fast, isolated
```

| Level | Scope | Count target | Tooling |
|---|---|---|---|
| **Unit** | Single module, no IPC | Many | Vitest / Rust #[test] |
| **Integration** | IPC contract, host↔renderer, host↔sidecar | Moderate | Vitest + IPC mocks or live Electron |
| **E2E** | Full user journey through the desktop app | 100+ functional + US-UI visual catalog | protocol smoke + Electron probes now; Playwright later |

**Strategy**: document all E2E scenarios; add or update unit/integration tests
alongside code when change risk makes them necessary; use selective, high-value
E2E suites for every code-bearing pull request. Lower-level tests localize
correctness, while E2E validates cross-process runtime behavior; passing lower
levels does not waive the relevant E2E gate.

---

## 4. Tooling Intent

| Tool | Purpose | Status |
|---|---|---|
| **Vitest** | Unit + integration (TS side) | Active (`pnpm test`, shared package) |
| **Rust #[test]** | Host-core unit tests | Active (`cargo test -p host-core`) |
| **Protocol smoke** | Host RPC + tools + plugins headless | Active (`test:e2e`, 22 checks) |
| **Electron probes** | Boot bridge, session-list responsiveness, and crash supervision | Active (`test:e2e:boot`, `test:e2e:supervision`) |
| **Playwright** | Full UI-driven journeys | Planned (post-M5) |

> Decision: protocol smoke and Electron probes are active validation assets;
> broader desktop journeys remain scenario-specific and must be recorded as
> environment-limited when their required platform is unavailable.

---

## 5. Environment Requirements

| Requirement | Detail |
|---|---|
| Platform | macOS arm64 and Intel x64, Windows x64, and Linux x64 and arm64 release targets (D126/D285, D638 / ADR 0318) |
| Profile | Clean `~/.pi-desktop` profile (no prior config) |
| Fixtures | Sample project directory (`examples/fixtures/sample-project/`) |
| Sample plugin | `examples/plugins/hello` loaded from local path |
| Provider | At least one provider with a valid key (test account) |
| Display | Headless-capable Electron or real display |

---

## 6. Scenario Template

Each scenario is documented in this format:

```markdown
### E2E-<ID>: <title>

- **Preconditions**: what must be true before steps start
- **Steps**: ordered list of user / system actions
- **Expected**: observable outcome that proves correctness
- **Specs linked**: relevant spec file(s)
- **Acceptance criterion**: which A–H letter(s) this verifies
- **Milestone**: M1–M6 target
- **Status**: Draft | Documented | Partially automated | Automated | Passed
```

---

## E2E Main Integration Validation

Every code-bearing change must pass the E2E suites relevant to its regression
surface on a candidate that already contains the latest `origin/main`, before
the request branch is pushed and the pull request is opened. Code-bearing
changes include Renderer, Electron Main, Preload, Agent Runtime, Rust
host-core, sessions, transcripts, plans, plugins, MCP, permissions,
provider/model runtime, persistence, process lifecycle, packaging/runtime
startup, and build or CI behavior that affects application execution.
Documentation-only changes are exempt when they do not alter executable
behavior.

Run the selected suites from the request worktree after `pnpm check:pr-base`
passes. An E2E run on a branch that is behind `origin/main` is exploratory and
does not satisfy this gate. Do not merge the task into local `main` to create
the candidate.

### E2E environment reuse

Task-candidate E2E runs from the request worktree after the candidate is
prepared, but uses the host development environment already provisioned in the
primary checkout. Reuse the compatible Node/pnpm toolchain, `node_modules`,
Electron, Rust/Cargo targets, package-manager stores, build caches, and ignored
configuration by reference or link when needed.

Do not run `pnpm install`, `npm install`, or create a second dependency/runtime
environment solely for E2E. Isolate only mutable test state: temporary
profiles, data directories, sockets, ports, logs, and artifacts. Install or
rebuild dependencies only when the host environment is missing or incompatible
and record the reason. Clean CI and release runners may install from lockfiles.

Use the root `package.json` as the source of truth for executable commands.
The minimum selection is:

- Cross-cutting runtime, host, or IPC: `pnpm test:e2e`.
- Electron startup, preload, or window lifecycle: `pnpm test:e2e` and
  `pnpm test:e2e:boot`. For packaged-startup regressions, also run
  `node scripts/e2e-electron-boot.mjs <packaged-executable>` against the
  installed-layout artifact with an isolated profile.
- Session-list refresh or model capability lookup: `pnpm test:e2e` and
  `pnpm test:e2e:boot`, including the synthetic large-list responsiveness check.
- Settings/composer/plugin search theme surfaces: `pnpm build:js` followed by
  `pnpm test:e2e:theme-surfaces`.
- Composer clipboard representation and text insertion: `pnpm test:e2e:composer-paste`.
- Composer slash-menu name/description layout: `pnpm build:js` followed by
  `pnpm test:e2e:composer-autocomplete`.
- Transcript render boundaries and cross-part delegation display: `pnpm test:e2e:transcript`.
- Plan host/runtime behavior: `pnpm test:e2e` and `pnpm test:e2e:plan`.
- Plan UI behavior: `pnpm test:e2e:plan` and `pnpm test:e2e:plan-ui`.
- Host supervision, crash recovery, or restart behavior: `pnpm test:e2e` and
  `pnpm test:e2e:supervision`.
- Subagent lifecycle: `pnpm test:e2e` and `pnpm test:e2e:subagents`.
- Imported-extension dependency installation or registry-boundary changes: `pnpm test:e2e:plugin-import-deps`.
- Trusted extension or plugin-extension changes: `pnpm test:e2e:trusted-extensions`.
- Session collaboration / Session Orchestrator: `pnpm test:e2e:collaboration`.
- Completion-notice silence or the silent-turn contract (D193 / D446): `pnpm test:e2e:session-completion`.
- Changes spanning multiple surfaces use the union of the applicable suites.

`pnpm test:e2e` is the default cross-system smoke suite for host RPC, IPC,
agent execution, plugins, persistence integration, and shared runtime
contracts. A required suite that cannot run because of a missing display,
platform, credential, hardware resource, or other environment capability must
be recorded as `NOT RUN` with its reason, alternative validation, and remaining
risk. The pull request may still be opened with that record so the change can
be validated in a capable environment, but the gate is not satisfied and
delivery remains incomplete until the suite passes against the integrated
`main` that carries the change.

Required results must apply to the executable commit the gate ran on, and any
later commit that changes the landed executable content requires a rerun of
the affected suites (landing fixes, conflict resolution, or commits added
during review). Otherwise the recorded result stands. Report each command,
result, tested commit, and any relevant environment limitation; never claim an
unexecuted suite passed.

## E2E Failure Policy

A failed required E2E blocks the branch push, the pull request, and declaring
the integrated delivery complete until the failure is classified as an
implementation regression, test regression, environment failure, or known
flaky infrastructure. Fix the product or test defect and rerun the affected
suite against the integrated `main`. Do not delete scenarios, weaken
assertions, or add retries that hide a deterministic failure. When a scenario
is not automated on the required platform, keep its status documented and
identify the platform validation still needed.

## 8. Traceability Matrix

| Acceptance | Scenarios |
|---|---|
| C / E / Security / Quality — Gemini work setup | E2E-LIVE-VOICE-gemini-work-schema |
| C / Quality — Continue after malformed tool output | E2E-RUNTIME-malformed-tool-call-continue-recovery |
| B / Security / Quality — Optional provider client certificate requests | E2E-PROVIDER-optional-client-certificate |
| C / E / F / Quality / Security — Session Todo checklist | E2E-CHAT-session-todo-checklist |
| C / E / Security / Quality — Live Voice four-stage interaction | E2E-LIVE-VOICE-four-stage-ui |
| C / F — Hourly task updates | E2E-SCHEDULED-manual-to-hourly |
| C / F / Quality — Saved project isolation | E2E-SCHEDULED-manual-workspace-binding |
| C / F / Quality — Desktop automations | E2E-SCHEDULED-desktop-automation-lifecycle |
| F / Security / Quality — Portable configuration sync | E2E-CONFIG-SYNC-s3-portable-configuration |
| A / C — Unicode stdio framing | E2E-RPC-unicode-separators |
| C / G / Quality — Plugins navigation | E2E-NAV-plugins-button-goes-back |
| C / D / Quality — Sidebar row states | E2E-LAYOUT-sidebar-row-states |
| E / Quality — Browser screenshot timeout recovery | E2E-BROWSER-capture-resize |
| A / C / Quality — Sidebar material and settings return | E2E-LAYOUT-sidebar-settings |
| C / Quality — Destination loading and focus | E2E-087b |
| A / H / Quality — Renderer process crash recovery | E2E-RUNTIME-renderer-crash-recovery |
| C / F / Quality — Project folder with chats detaches and deletes safely | E2E-048c |
| B / F / Security — Provider copy | E2E-PROVIDER-copy-config-without-credentials |
| C / Quality — Self-hosted endpoint receives the session id | E2E-PROVIDER-custom-endpoint-session-identity |
| B / F / Quality — Selected model order | E2E-MODEL-selected-order-persists |
| E / F / Quality — MCP server timeout override | E2E-261 |
| A — App startup | E2E-001, E2E-002, E2E-003, E2E-004, E2E-067, E2E-076, E2E-079, E2E-092, E2E-097, E2E-143, E2E-150, E2E-168, E2E-204 |
| A / C / F / Quality — Tray session navigation | E2E-TRAY-bounded-session-navigation |
| B — Model config | E2E-005, E2E-PROVIDER-custom-endpoint-no-api-key, E2E-006, E2E-007, E2E-038, E2E-050, E2E-052, E2E-055, E2E-066, E2E-080, E2E-082, E2E-102c, E2E-102d, E2E-102e, E2E-151, E2E-154, E2E-163, E2E-166, E2E-172, E2E-174, E2E-197, E2E-005G, E2E-005J, E2E-199, E2E-201, E2E-202, E2E-203, E2E-205, E2E-206, E2E-209, E2E-PLUGIN-provider-catalog-add-service |
| C — Conversation & stream | E2E-CHAT-long-history-stream-keeps-responsive, E2E-CHAT-running-status-survives-output-pauses, E2E-008, E2E-008d, E2E-008e, E2E-008a, E2E-009, E2E-010, E2E-011, E2E-011a, E2E-011b, E2E-011d, E2E-011e, E2E-011g, E2E-031, E2E-040, E2E-047, E2E-048, E2E-048A, E2E-049, E2E-052, E2E-053, E2E-054, E2E-055, E2E-059, E2E-059a, E2E-060c, E2E-060d, E2E-061, E2E-061a, E2E-062, E2E-064, E2E-065, E2E-068, E2E-071, E2E-073, E2E-074, E2E-075, E2E-081, E2E-083, E2E-084, E2E-086, E2E-087, E2E-088, E2E-088b, E2E-089, E2E-090, E2E-COMPOSER-narrow-controls, E2E-094, E2E-095, E2E-096, E2E-097, E2E-098, E2E-099, E2E-102, E2E-102a, E2E-102b, E2E-102c, E2E-102d, E2E-102g, E2E-106, E2E-109, E2E-111, E2E-114, E2E-116, E2E-117, E2E-118, E2E-119, E2E-120, E2E-121, E2E-218, E2E-259, E2E-219, E2E-AGENTS-001, E2E-142, E2E-144, E2E-145, E2E-146, E2E-146a, E2E-147, E2E-151, E2E-154, E2E-155, E2E-158, E2E-159, E2E-161, E2E-162, E2E-166, E2E-172, E2E-173, E2E-174, E2E-177, E2E-178, E2E-179, E2E-180, E2E-182, E2E-183, E2E-187, E2E-198, E2E-199, E2E-202, E2E-203, E2E-207, E2E-208, E2E-CHAT-content-width-handles, E2E-250, E2E-102i, E2E-PLUGIN-session-orchestrator-real-workers, E2E-SUBAGENT-settlement-updates-before-parent-poll, E2E-SUBAGENT-resume-a-settled-delegation |
| C — Conversation & stream (composer drafts) | E2E-011c, E2E-011c-1, E2E-011c-2 |
| D — Workspace | E2E-012, E2E-013, E2E-022B, E2E-024I, E2E-047, E2E-049, E2E-057, E2E-058, E2E-060, E2E-068, E2E-075, E2E-078, E2E-153, E2E-158, E2E-182, E2E-187, E2E-252 |
| C / D / Quality — Project session history resets after collapse | E2E-263 |
| D — Workspace (project ordering) | E2E-253 |
| E — Tools & permissions | E2E-008a, E2E-014, E2E-015, E2E-016, E2E-017, E2E-018, E2E-019, E2E-024I, E2E-024K, E2E-040, E2E-049, E2E-074, E2E-093, E2E-097, E2E-099, E2E-100, E2E-101, E2E-102, E2E-102d, E2E-102e, E2E-102g, E2E-103, E2E-105, E2E-106, E2E-107, E2E-111, E2E-112, E2E-113, E2E-114, E2E-115, E2E-116, E2E-119, E2E-121, E2E-122, E2E-142, E2E-145, E2E-147, E2E-155, E2E-158, E2E-166, E2E-181, E2E-PLUGIN-imported-pi-package-skills |
| F — Persistence | E2E-020, E2E-021, E2E-021a, E2E-038, E2E-SETTINGS-inline-capability-imports, E2E-040, E2E-042, E2E-047, E2E-048, E2E-051, E2E-054, E2E-056, E2E-061, E2E-062, E2E-064, E2E-066, E2E-068, E2E-071, E2E-072, E2E-073, E2E-082, E2E-084, E2E-096, E2E-098, E2E-102, E2E-102b, E2E-102c, E2E-102d, E2E-102g, E2E-102i, E2E-103, E2E-AGENTS-001, E2E-061a, E2E-073a, E2E-104, E2E-106, E2E-107, E2E-108, E2E-109, E2E-110, E2E-112, E2E-118, E2E-119, E2E-120, E2E-121, E2E-123, E2E-142, E2E-146, E2E-146a, E2E-148, E2E-151, E2E-158, E2E-160, E2E-168, E2E-171, E2E-177, E2E-178, E2E-183, E2E-186, E2E-005J, E2E-PROVIDER-custom-endpoint-no-api-key, E2E-PLUGIN-session-orchestrator-real-workers, E2E-PLUGIN-provider-catalog-add-service, E2E-SESSION-outbox-unclassifiable-failure-does-not-stall-the-queue |
| F — Persistence (project ordering) | E2E-251 |
| G / Update — Bundled Official Enhancements defaults | E2E-PLUGIN-bundled-enhancements-defaults |
| G / Security — Fetch redirect policy | E2E-PLUGIN-fetch-redirect-policy |
| G — Plugins | E2E-022, E2E-022A, E2E-022B, E2E-022C, E2E-023, E2E-024, E2E-024B, E2E-024C, E2E-024D, E2E-024AA, E2E-024E, E2E-024W, E2E-024F, E2E-024G, E2E-024H, E2E-024I, E2E-024J, E2E-024K, E2E-024L, E2E-024M, E2E-024N, E2E-024O, E2E-024P, E2E-025, E2E-026, E2E-105, E2E-117, E2E-120, E2E-122, E2E-123, E2E-024Q, E2E-148, E2E-152, E2E-153, E2E-PLUGIN-imported-pi-package-skills, E2E-PLUGIN-imported-pi-package-wrapper, E2E-PLUGIN-import-extension-installs-dependencies, E2E-PLUGIN-import-extension-reports-missing-dependency, E2E-PLUGIN-global-shortcut-owns-only-its-own-command, E2E-PLUGIN-permission-gate-for-real-time-capabilities, E2E-PLUGIN-background-audio-and-realtime-connection, E2E-PLUGIN-fs-root-follows-the-calling-session, E2E-PLUGIN-provider-catalog-add-service, E2E-PLUGIN-reviews-public-reads |
| H — Diagnostics | E2E-027, E2E-031, E2E-034, E2E-042, E2E-096, E2E-098, E2E-104, E2E-107, E2E-108, E2E-109, E2E-110, E2E-113, E2E-115, E2E-116, E2E-118, E2E-121, E2E-146, E2E-146a, E2E-155, E2E-159, E2E-176, E2E-194, E2E-195 |
| Security | E2E-SETTINGS-inline-capability-imports, E2E-028, E2E-029, E2E-030, E2E-024J, E2E-024K, E2E-024M, E2E-049, E2E-068, E2E-086, E2E-102c, E2E-102d, E2E-102e, E2E-105, E2E-106, E2E-107, E2E-108, E2E-109, E2E-110, E2E-112, E2E-113, E2E-115, E2E-116, E2E-117, E2E-119, E2E-121, E2E-122, E2E-123, E2E-142, E2E-148, E2E-151, E2E-153, E2E-158, E2E-187, E2E-196c, E2E-196b, E2E-196, E2E-PROVIDER-custom-endpoint-no-api-key, E2E-PLUGIN-fs-root-follows-the-calling-session, E2E-PLUGIN-provider-catalog-add-service, E2E-PLUGIN-reviews-public-reads |
| Quality | E2E-SETTINGS-inline-capability-imports, E2E-CHAT-long-history-stream-keeps-responsive, E2E-CHAT-running-status-survives-output-pauses, E2E-032, E2E-033, E2E-039, E2E-043, E2E-044, E2E-045, E2E-046, E2E-047, E2E-048, E2E-048A, E2E-049, E2E-050, E2E-053, E2E-055, E2E-056, E2E-057, E2E-058, E2E-059, E2E-060, E2E-061, E2E-062, E2E-063, E2E-064, E2E-065, E2E-066, E2E-067, E2E-068, E2E-069, E2E-070, E2E-071, E2E-072, E2E-073, E2E-074, E2E-075, E2E-076, E2E-077, E2E-078, E2E-079, E2E-080, E2E-081, E2E-082, E2E-083, E2E-084, E2E-085, E2E-086, E2E-092, E2E-093, E2E-094, E2E-095, E2E-096, E2E-097, E2E-098, E2E-099, E2E-100, E2E-101, E2E-102, E2E-102a, E2E-102b, E2E-102c, E2E-102d, E2E-102e, E2E-103, E2E-AGENTS-001, E2E-021a, E2E-024N, E2E-059a, E2E-060b, E2E-060c, E2E-061a, E2E-073a, E2E-111, E2E-114, E2E-117, E2E-118, E2E-119, E2E-120, E2E-122, E2E-123, E2E-142, E2E-143, E2E-144, E2E-145, E2E-146, E2E-147, E2E-148, E2E-150, E2E-151, E2E-153, E2E-155, E2E-158, E2E-159, E2E-160, E2E-161, E2E-162, E2E-163, E2E-168, E2E-172, E2E-173, E2E-174, E2E-011g, E2E-176, E2E-177, E2E-178, E2E-179, E2E-180, E2E-181, E2E-182, E2E-183, E2E-186, E2E-187, E2E-194, E2E-195, E2E-196a, E2E-196b, E2E-196c, E2E-198, E2E-199, E2E-200, E2E-196, E2E-201, E2E-204, E2E-202, E2E-203, E2E-205, E2E-206, E2E-207, E2E-208, E2E-209, E2E-210, E2E-UPDATE-preference-and-once-only-reminder, E2E-218, E2E-259, E2E-219, E2E-250, E2E-252, E2E-102i, E2E-SUBAGENT-settlement-updates-before-parent-poll, E2E-PLUGIN-imported-pi-package-skills, E2E-PLUGIN-fs-root-follows-the-calling-session, E2E-SUBAGENT-resume-a-settled-delegation, E2E-PLUGIN-provider-catalog-add-service |
| Quality (sidebar menu placement) | E2E-021c |
| Quality (project ordering) | E2E-253 |
| Quality (work-panel tab close visibility) | E2E-WORK-PANEL-active-tab-close-visibility |
| Quality (turn changed-files disclosure) | E2E-CHAT-turn-changed-files-summary |
| C / E / G / Quality — Pi kernel upgrade | E2E-PI-130-kernel-upgrade |
| C / E / G / Quality — Pi kernel upgrade | E2E-PI-140-kernel-upgrade |
| C — Conversation & stream (IME slash alias) | E2E-255 |
| E — Tools & permissions (Skill residency) | E2E-254 |
| Quality (Skill residency and IME slash alias) | E2E-254, E2E-255 |
| C / E / F / Quality — Built-in skill activation | E2E-SKILL-builtin-activation |
| Quality — Market catalog retry recovery | E2E-MARKET-CATALOG-RETRY |
| C — Conversation & stream (plugin session import visibility) | E2E-257 |
| F — Persistence (plugin session import visibility) | E2E-257 |
| G — Plugins (session import visibility) | E2E-257 |
| Quality (plugin session import visibility) | E2E-257 |
| Quality (Windows updater cache) | E2E-260 |
| G — Plugins (Session Orchestrator) | E2E-PLUGIN-session-orchestrator-real-workers |
| Security (Session Orchestrator) | E2E-PLUGIN-session-orchestrator-real-workers |
| Quality (Session Orchestrator) | E2E-PLUGIN-session-orchestrator-real-workers |
| C — Conversation & stream (Session list responsiveness) | E2E-SESSION-list-refresh-keeps-desktop-responsive |
| Quality (Session list responsiveness) | E2E-SESSION-list-refresh-keeps-desktop-responsive |
| Security (imported extension dependencies) | E2E-PLUGIN-import-extension-installs-dependencies, E2E-PLUGIN-import-extension-reports-missing-dependency |
| Quality (imported extension dependencies) | E2E-PLUGIN-import-extension-installs-dependencies, E2E-PLUGIN-import-extension-reports-missing-dependency |
| F / G / Security / Quality — Imported extension npm recovery | E2E-PLUGIN-import-extension-recovers-missing-npm |
| G — Plugins (desktop tool dispatch budget) | E2E-PLUGIN-slow-tool-is-not-cut-off-by-host-dispatch |
| C — Conversation & stream (Independent session communication) | E2E-SESSION-independent-top-level-communication |
| D — Plugin security (Independent session communication) | E2E-SESSION-independent-top-level-communication |
| G — Plugins (Independent session communication) | E2E-SESSION-independent-top-level-communication |
| Quality (Independent session communication) | E2E-SESSION-independent-top-level-communication, E2E-SESSION-hover-card-model-and-links |
| C — Conversation & stream (Hover card model and links) | E2E-SESSION-hover-card-model-and-links |
| C — Conversation & stream (Chat file references) | E2E-CHAT-shorthand-file-ref-opens-the-matching-file, E2E-CHAT-file-ref-opens-the-surface-that-owns-it |
| C / Quality / Security (Conversation MP4 attachments) | E2E-CHAT-mp4-attachment-opens-in-system-player |
| G — Plugins (Chat file references) | E2E-CHAT-file-ref-opens-the-surface-that-owns-it, E2E-PLUGIN-file-view-collapse-persists |
| Quality (Chat file references) | E2E-CHAT-shorthand-file-ref-opens-the-matching-file, E2E-CHAT-file-ref-opens-the-surface-that-owns-it, E2E-PLUGIN-file-view-collapse-persists |
| C / Quality (Composer deep file mentions) | E2E-COMPOSER-deep-file-mentions |
| G — Plugins (project folder roots) | E2E-PLUGIN-file-view-switches-folder-per-project |
| Security (project folder roots) | E2E-PLUGIN-file-view-switches-folder-per-project |
| Quality (project folder roots) | E2E-PLUGIN-file-view-switches-folder-per-project |
| D — Workspace (project delete) | E2E-PROJECT-delete-removes-project-and-owned-sessions |
| F — Persistence (project delete) | E2E-PROJECT-delete-removes-project-and-owned-sessions |
| Quality (project delete) | E2E-PROJECT-delete-removes-project-and-owned-sessions |
| Quality (two-click delete) | E2E-SESSION-two-click-delete-arms-first |
| Security (plugin real-time capabilities) | E2E-PLUGIN-global-shortcut-owns-only-its-own-command, E2E-PLUGIN-permission-gate-for-real-time-capabilities, E2E-PLUGIN-background-audio-and-realtime-connection |
| C — Conversation & stream (disclosure reading position) | E2E-CHAT-disclosure-toggle-keeps-reading-position |
| E — Tools & permissions (disclosure reading position) | E2E-CHAT-disclosure-toggle-keeps-reading-position |
| D (surfaces) / Quality — Remote-host Add and Pair form disclosure | E2E-REMOTE-HOST-settings-compact-inventory |
| E — Tools & permissions (capability level move) | E2E-CAPABILITY-move-across-levels |
| F — Persistence (capability level move) | E2E-CAPABILITY-move-across-levels |
| Quality (capability level move) | E2E-CAPABILITY-move-across-levels |

| Milestone | Scenarios |
|---|---|
| Post-MVP experimental interaction maintenance | E2E-LIVE-VOICE-four-stage-ui |
| M1 | E2E-001, E2E-002, E2E-003, E2E-028, E2E-029 |
| M2 | E2E-004, E2E-005, E2E-006, E2E-007, E2E-008, E2E-008d, E2E-008e, E2E-009, E2E-010, E2E-011, E2E-011a, E2E-011b, E2E-011d, E2E-011e, E2E-011g, E2E-020, E2E-021, E2E-021a, E2E-027, E2E-031, E2E-042, E2E-087, E2E-088, E2E-088b, E2E-089, E2E-090, E2E-COMPOSER-narrow-controls, E2E-144, E2E-005J, E2E-201, E2E-202, E2E-207, E2E-206 |
| M2 (sidebar menu placement) | E2E-021c |
| M3 | E2E-012, E2E-013, E2E-014, E2E-015, E2E-016, E2E-017, E2E-018, E2E-019, E2E-040 |
| M4 | E2E-022, E2E-023, E2E-024, E2E-025, E2E-026, E2E-030, E2E-038 |
| M5 | E2E-CHAT-long-history-stream-keeps-responsive, E2E-CHAT-running-status-survives-output-pauses, E2E-008a, E2E-032, E2E-033, E2E-034, E2E-039, E2E-043, E2E-044, E2E-045, E2E-046, E2E-047, E2E-048, E2E-048A, E2E-049, E2E-050, E2E-051, E2E-052, E2E-053, E2E-054, E2E-055, E2E-056, E2E-057, E2E-058, E2E-059, E2E-060, E2E-061, E2E-062, E2E-063, E2E-064, E2E-065, E2E-066, E2E-067, E2E-068, E2E-069, E2E-070, E2E-071, E2E-072, E2E-073, E2E-074, E2E-075, E2E-076, E2E-077, E2E-078, E2E-079, E2E-080, E2E-081, E2E-082, E2E-083, E2E-084, E2E-085, E2E-086, E2E-092, E2E-093, E2E-096, E2E-097, E2E-098, E2E-099, E2E-100, E2E-101, E2E-102, E2E-102a, E2E-102b, E2E-102c, E2E-102d, E2E-102e, E2E-AGENTS-001, E2E-059a, E2E-060b, E2E-060c, E2E-061a, E2E-073a, E2E-094, E2E-095, E2E-143, E2E-145, E2E-146, E2E-146a, E2E-147, E2E-177, E2E-178, E2E-180, E2E-181, E2E-182, E2E-183, E2E-186, E2E-187, E2E-194, E2E-195, E2E-204, E2E-208, E2E-CHAT-content-width-handles, E2E-250, E2E-252, E2E-102i, E2E-BROWSER-capture-resize |
| M5 (project ordering) | E2E-253 |
| M2 (IME slash alias) | E2E-255 |
| M5 (Skill residency) | E2E-254 |
| M6 | E2E-104, E2E-105, E2E-106, E2E-107, E2E-108, E2E-109, E2E-110, E2E-111, E2E-112, E2E-113, E2E-114, E2E-115, E2E-116, E2E-117, E2E-118, E2E-119, E2E-120, E2E-103, E2E-172 |
| M6+ | E2E-121, E2E-122, E2E-148, E2E-150, E2E-151, E2E-154, E2E-155, E2E-158, E2E-159, E2E-160, E2E-161, E2E-162, E2E-163, E2E-166, E2E-168, E2E-173, E2E-174, E2E-176, E2E-179, E2E-196a, E2E-196b, E2E-196c, E2E-198, E2E-199, E2E-200, E2E-202, E2E-203, E2E-205, E2E-209, E2E-SETTINGS-inline-capability-imports, E2E-210, E2E-UPDATE-preference-and-once-only-reminder, E2E-212, E2E-213, E2E-214, E2E-215, E2E-216, E2E-217, E2E-218, E2E-259, E2E-219, E2E-257, E2E-SUBAGENT-settlement-updates-before-parent-poll, E2E-PLUGIN-fs-root-follows-the-calling-session, E2E-SUBAGENT-resume-a-settled-delegation |
| M6+ (Session Orchestrator) | E2E-PLUGIN-session-orchestrator-real-workers |
| M6+ (Selected model order) | E2E-MODEL-selected-order-persists |
| M6+ (MCP server timeout override) | E2E-261 |
| M6+ (Destination loading and focus) | E2E-087b |
| M6+ (Session list responsiveness) | E2E-SESSION-list-refresh-keeps-desktop-responsive |
| M6+ (Windows updater cache) | E2E-260 |
| M6+ (Independent session communication) | E2E-SESSION-independent-top-level-communication, E2E-SESSION-hover-card-model-and-links |
| M5 (Chat file references) | E2E-CHAT-shorthand-file-ref-opens-the-matching-file, E2E-CHAT-file-ref-opens-the-surface-that-owns-it |
| M5 (Composer deep file mentions) | E2E-COMPOSER-deep-file-mentions |
| M5 (Conversation MP4 attachments) | E2E-CHAT-mp4-attachment-opens-in-system-player |
| M6+ (Chat file references) | E2E-PLUGIN-file-view-collapse-persists |
| M6+ (project folder roots) | E2E-PLUGIN-file-view-switches-folder-per-project |
| Post-MVP | E2E-022A, E2E-022B, E2E-022C, E2E-024I, E2E-024J, E2E-024K, E2E-024L, E2E-024M (plugin roadmap R2/R3/R6) |
| Post-baseline local automation | E2E-220 |
| Post-baseline local automation (MCP `pi_session_get` large compaction) | E2E-MCP-session-get-projects-large-compaction |
| Post-MVP remote control | E2E-221, E2E-222, E2E-223, E2E-224, E2E-225, E2E-226, E2E-227, E2E-228, E2E-229, E2E-230, E2E-231, E2E-232, E2E-REMOTE-HOST-settings-compact-inventory |
| Trusted extensions (R7 v1) | E2E-DIALOG-long-text-boundaries, E2E-241, E2E-242, E2E-HOOKS-prompt-chain, E2E-HOOKS-context-every-request, E2E-HOOKS-cancel-and-dispose, E2E-TRUSTED-EXTENSION-custom-agent-stream-and-binding, E2E-243, E2E-TRUSTED-EXTENSION-temporary-session-cwd-is-scratch, E2E-244, E2E-245, E2E-PLUGIN-imported-pi-package-skills, E2E-PLUGIN-import-extension-installs-dependencies, E2E-PLUGIN-import-extension-reports-missing-dependency, E2E-PLUGIN-declared-provider-appears-in-the-native-provider-list, E2E-PLUGIN-provider-catalog-add-service |
| Trusted extensions (R7 v1 npm recovery) | E2E-PLUGIN-import-extension-recovers-missing-npm |
| Post-MVP regression coverage (plugin tool dispatch) | E2E-PLUGIN-slow-tool-is-not-cut-off-by-host-dispatch |
| M6+ (Project delete) | E2E-PROJECT-delete-removes-project-and-owned-sessions |
| M6+ (Two-click delete) | E2E-SESSION-two-click-delete-arms-first |
| C — Conversation & stream (model fallback) | E2E-SUBAGENT-ordered-model-fallback-preserves-work |
| Quality (model fallback isolation) | E2E-SUBAGENT-ordered-model-fallback-preserves-work |
| C — Conversation & stream (legacy subagent turn limit) | E2E-SUBAGENT-legacy-turn-limit-frontmatter-is-ignored |
| Quality (legacy subagent turn limit) | E2E-SUBAGENT-legacy-turn-limit-frontmatter-is-ignored |
| M6+ (disclosure reading position) | E2E-CHAT-disclosure-toggle-keeps-reading-position |
| M6+ (capability level move) | E2E-CAPABILITY-move-across-levels |
| E — Tools & permissions (builtin subagent defaults) | E2E-SUBAGENT-settings-lists-builtin-defaults |
| Quality (builtin subagent defaults) | E2E-SUBAGENT-settings-lists-builtin-defaults |
| C — Conversation & stream (opaque floating surfaces) | E2E-CHAT-opaque-floating-decision-and-retry-surfaces |
| Quality (opaque floating surfaces) | E2E-CHAT-opaque-floating-decision-and-retry-surfaces |
| M6 (opaque floating surfaces) | E2E-CHAT-opaque-floating-decision-and-retry-surfaces |
| B — Model config (catalog window provenance) | E2E-MODEL-catalog-window-correction-reaches-saved-bindings |
| F — Persistence (catalog window provenance) | E2E-MODEL-catalog-window-correction-reaches-saved-bindings |
| Quality (catalog window provenance) | E2E-MODEL-catalog-window-correction-reaches-saved-bindings |
| M6+ (catalog window provenance) | E2E-MODEL-catalog-window-correction-reaches-saved-bindings |
| C — Conversation & stream (delegate context budget) | E2E-SUBAGENT-context-overflow-compacts-before-failing, E2E-SUBAGENT-context-overflow-reports-actionable-failure, E2E-SUBAGENT-resume-seeds-within-context-budget |
| Quality (delegate context budget) | E2E-SUBAGENT-context-overflow-compacts-before-failing, E2E-SUBAGENT-context-overflow-reports-actionable-failure, E2E-SUBAGENT-resume-seeds-within-context-budget |
| M6+ (delegate context budget) | E2E-SUBAGENT-context-overflow-compacts-before-failing, E2E-SUBAGENT-context-overflow-reports-actionable-failure, E2E-SUBAGENT-resume-seeds-within-context-budget |
| C / F / Quality — The context estimate stays safe (calibration) | E2E-CONTEXT-estimate-calibration-stays-safe |
| C — Conversation & stream (unique tool-call ids) | E2E-RUNTIME-unique-tool-call-ids-per-request |
| F — Persistence (stored model binding array) | E2E-PROVIDER-stored-binding-array-reads-entry-by-entry |
| Quality (stored model binding array) | E2E-PROVIDER-stored-binding-array-reads-entry-by-entry |
| Quality (unique tool-call ids) | E2E-RUNTIME-unique-tool-call-ids-per-request |
| C — Conversation & stream (system update during a tool call, restored) | E2E-RUNTIME-system-update-during-tool-call-restore |
| Quality (system update during a tool call, restored) | E2E-RUNTIME-system-update-during-tool-call-restore |
| C — Conversation & stream (loop context ownership) | E2E-RUNTIME-loop-context-ownership |
| C / F / Quality — Transcript invalid UTF-8 recovery | E2E-TRANSCRIPT-invalid-utf8-window-remains-readable |
| Quality (loop context ownership) | E2E-RUNTIME-loop-context-ownership |
| G — Plugin host lifecycle (crash report) | E2E-PLUGIN-crash-report-names-the-exit-code |
| Quality (crash report) | E2E-PLUGIN-crash-report-names-the-exit-code |
| C / E / F / Quality — Background Bash tasks outlive their turn | E2E-265 |
| C / E / Security / Quality — Codemode sandboxed nested calls | E2E-CODEMODE-sandboxed-nested-calls |

The `US-UI-*` visual scenarios (§UI shell visual scenarios) trace to the
Codex parity decisions in [decisions-log §D](../08-meta/decisions-log.md)
rather than the A–H criteria; their gold source is the capture suite.

The release artifact paths are covered by E2E-192, E2E-192a, E2E-196a,
E2E-196b, E2E-196c, and E2E-200 (Quality, M6+).

---

## 9. How AI Must Update This Doc

When adding or changing a feature that affects user-visible or protocol-visible behavior:

1. **Add a new scenario** using the template in §6 to the domain catalog that
   owns it (see [Scenario catalogs](#scenario-catalogs)). Assign the next available ID
   (`E2E-<N>`). IDs retired by ADR 0268 are never reused.
2. **Link it** to the relevant acceptance criterion (A–H) and milestone (M1–M6
   or M6+ for the current product increment).
3. **Set status** to `Draft` unless an automated test already exists.
4. **Update the traceability matrix** in §8.
5. **Commit** the update as part of the change (per [ai-development-workflow](03-ai-development-workflow.md) R3).

---

## 10. Future Automation Mapping

When E2E automation is implemented (post-M5):

- Each `Draft` scenario → Playwright test file.
- Scenario ID becomes test case name: `e2e-001-app-launches`.
- Fixtures and test data paths defined in a `tests/e2e/fixtures/` directory.
- CI gate: all E2E scenarios must pass before release.

Automation section will be expanded in a future ADR when the tooling decision is finalized.

---

## 11. Acceptance Criteria

This test plan spec is accepted when:

- [ ] All MVP acceptance criteria (A–H) have at least one E2E scenario.
- [ ] All security acceptance items have at least one E2E scenario.
- [ ] Every scenario links to at least one spec document.
- [ ] Traceability matrix is complete (scenarios ↔ acceptance ↔ milestones).
- [ ] Scenario template is defined and all entries follow it.
- [ ] AI update rules are documented and cross-linked to workflow spec.
- [ ] Environment requirements match baseline (native macOS arm64/Intel x64,
  clean profile).

## Claude prompt-cache duration

Run **node scripts/e2e-claude-cache.mjs** from the task worktree after building
Host, shared packages, runtime bundle and Electron. Reuse the existing toolchain
via PI_DESKTOP_HOST_BIN, PI_E2E_ELECTRON and PI_E2E_PLAYWRIGHT if necessary.
Only the local HTTP model endpoint is simulated; profiles and screenshots stay
isolated and retained. No real account, paid API or installed app is exercised.

| ID | User sequence and required result |
| --- | --- |
| E2E-CLAUDE-CACHE-01 | Settings -> Models -> provider -> Claude Advanced. Select 1 hour by keyboard, save, send a chat and inspect actual cache_control markers for ttl: 1h. |
| E2E-CLAUDE-CACHE-02 | Restart the same isolated profile; the setting stays 1 hour. A non-Claude model has no Claude-cache selector. |
| E2E-CLAUDE-CACHE-03 | Change to 5 minutes, save, send again and verify no 1h marker remains. Capture settings and chat screenshots. |
| E2E-CLAUDE-CACHE-04 | Seed local account catalog metadata without authorization, then change and save the MirrorCoding model's cache duration through its real settings component. Inspect Host-persisted value. |
| E2E-CLAUDE-CACHE-05 | On the main page select Claude in the model/reasoning menu, choose 1 hour beneath the reasoning slider and send. Inspect actual HTTP cache markers, advanced-settings synchronization and restart persistence. Choose 5 minutes by keyboard and send again; no 1h marker remains. |
| E2E-CLAUDE-CACHE-06 | Switch to a non-Claude model and back: the cache row hides and the previous Claude preference survives. Preserve a typed draft and reasoning choice; capture dark/wide and light/narrow menus. |
| E2E-CLAUDE-CACHE-07 | Select a locally seeded MirrorCoding group in the main-page model menu, change cache duration there and verify the account binding and projected group agree. No production authentication or model request is made. |

Runtime HTTP tests also cover delegate requests, explicit no-cache requests and
unaffected non-Claude/non-Anthropic routes. Host tests cover strict enum parsing,
normalization, JSON persistence and MirrorCoding account refresh projection.


## Selected references and temporary side chat

### Selection context menu and region screenshot

Run `node scripts/e2e-composer-screenshot.mjs` in the task worktree using the
shared Host/Electron/Playwright binaries and an isolated profile. Only the local
HTTP provider is simulated; screen capture, selection windows, preload, importer,
drafts and sends use production wiring. Retain only fixture-window evidence.

| ID | User sequence and required result |
| --- | --- |
| E2E-EXCERPT-CONTEXT | Select message text, right-click, then scroll/resize. Only the context menu remains and the selected text survives. Select again and add the quote normally. |
| E2E-SCREENSHOT-CANCEL | Type a draft, open capture twice, cancel with Esc. One selection flow exists, all selectors close, no file/request is created and the draft survives. |
| E2E-SCREENSHOT-ATTACH | Open the camera action, reverse-drag a region, release. The PNG dimensions/pixels match the selected region, text/quotes survive and no request is sent until Enter. |
| E2E-SCREENSHOT-SIDE | Capture from a side composer. Its own session owns the image, the main draft stays unchanged, and right-click cancellation adds nothing. |

Run `node scripts/e2e-selection-side-chat.mjs` from the request worktree with
the shared Host/Electron toolchain. It creates an isolated profile and local
HTTP model fixture, retains evidence, and never uses a user's running instance.

| ID | User sequence and required result |
| --- | --- |
| E2E-EXCERPT-01 | Select across messages and hidden controls, then select Chinese, code and math; add/remove references without losing the draft. Send and inspect stored metadata and actual model request. |
| E2E-EXCERPT-02 | Queue a referenced question while the main reply streams; edit it back into the draft, requeue, and remove it. Use immediate steering with a reference, queue another referenced question, release the provider stream, and verify both actual requests and saved reference metadata. |
| E2E-EXCERPT-03 | Inspect compact selection actions without a surrounding box; expand borderless annotations in main and side composers. Focus the numbered source to reveal full provenance, toggle with Enter, and remove through the accessible close icon. Verify draft preservation, narrow-pane fit, and dark/light screenshots. |
| E2E-TEMPCHAT-01 | Open a side while the main streams; repeat selection; preserve draft/config. Approve a real Write in the shared test directory without interrupting or contaminating the main transcript. |
| E2E-TEMPCHAT-02 | Stop a child before any output; restore question and references; resend with inherited context and previous child replies intact, without the abandoned prompt. |
| E2E-TEMPCHAT-03 | Switch main sessions and return, visit Settings and return, then inspect dark/light and narrow overlay layouts. Draft/history survive hiding; width preferences do not change. |
| E2E-TEMPCHAT-04 | Close with a running stream and queued question; confirm cancellation, absent child history, no queued execution, and preserved project file. Restart with another stale child and verify cleanup without replay. |
| E2E-TEMPCHAT-05 | Change only the side model/reasoning level, complete a Plan turn, return to Agent mode, then edit/regenerate an earlier referenced child message. Inherited/prior child context survives; discarded turns do not return and parent configuration is unchanged. |
| E2E-TEMPCHAT-06 | Close while a Write awaits approval; it must settle without executing the write. Close another side while its delegated task streams; the delegate must stop and neither child may remain in history. |
| E2E-TEMPCHAT-07 | Reload with an old 80px panel preference, open a side, resize narrow/wide and close via its visible tab control. Rendered side width recovers to 360px without replacing the 80px preference. |
| E2E-TEMPCHAT-08 | Finish a side reply, expand the panel, type a multiline draft and return to the narrow drawer in both themes. Transcript reserve equals the overlay composer once; main/side share dock padding, shell styling and a single toolbar row. Check signed-in quota, context, permission, model and send targets at seven widths from 360 to 900px; none overlap. |

Runtime adapter tests additionally inspect compacted context, latest replies,
completed tool evidence, incomplete-call filtering, and absence of parent
records in child persistence. Host tests exercise uniqueness, inherited policy,
parent-delete ordering and no resurrection. Main quoted edits/steering and
child configuration changes run through the same Electron user-path suite.
### E2E-CODEX-migrated-project-search

- Scan a source containing SQLite projects and legacy UI project assignments
  joined by Codex's saved mapping for the selected local host. Open the project
  menu, select its single current entry, and search by the thread display name.
  The matching conversation remains selectable and imports into that project.
- Preserve unrelated same-name projects and ignore remote-host mappings. Repeated
  import skips the existing native session. Source databases remain read-only.
- Coverage: Host catalog user-path regression and the card-open stage of
  `scripts/e2e-codex-import.mjs`, with real Electron IPC and synthetic SQLite.


## Storage junction normalization

Create a dangling Windows junction with standalone Node, then migrate its
containing profile through real Electron. Migration must complete even when
the source target has a trailing separator, preserving the same unresolved
target and the original profile. Exercise this with the cross-drive Settings
to cold-restart journey as well as the focused filesystem regression.


## Delegate mutation recovery

| ID | User sequence and expected result |
| --- | --- |
| E2E-DELEGATE-EDIT-01 | Start two writing subagents against one file. After A emits visible text, make A submit three malformed Edit operations while B submits two. A returns a failed Task result with `MUTATION_RETRY_BUDGET_EXHAUSTED`; B completes after A stops, and the parent turn remains successful. Resume A with `Task(resume)` and confirm the resumed run completes. A new parent prompt has a fresh budget while a still-running delegate retains its own budget. |


## Native file tools: PowerShell logs

Run a PowerShell command that writes a UTF-16LE BOM log to session scratch,
then use `Read` on its absolute path. The returned lines must be readable text,
not `TOOL_BINARY_CONTENT`. Edit one line through the public `Edit` tool and
confirm the file retains its UTF-16LE BOM and content. A NUL-bearing binary
file must still be rejected.


## Mobile companion acceptance

The account-sync suite also runs sync-failure.mjs in both touch-browser and native
Android lanes: reopen a cached conversation, commit the first changed page,
inject a live update and fail the next page at the relay boundary. Confirm the
first page and live update remain visible, controls/catalog are restored, the
technical details are expandable, and explicit retry retrieves only the missing
delta without another prompt or snapshot. Existing offline, revocation, desktop
restart and 610-row history checks then continue on the same app instance.

Validate this opt-in post-baseline feature on the dedicated request candidate
containing the latest applicable `origin/main`, per root AGENTS.md. Do not merge
into local main to prepare validation. Historical main-integration instructions
below do not govern the current delivery workflow.

| ID | User sequence and expected result |
| --- | --- |
| E2E-MOBILE-01 | Desktop context menu → pairing code → same-account Android login/claim → only the selected project/session appears. Wrong account, expired/cancelled/reused code and unpaired device are refused. |
| E2E-MOBILE-02 | Open a running session, page history, observe streamed text/thinking/tool details and send from phone. Desktop receives the same durable message once and uses its current model/mode. |
| E2E-MOBILE-03 | Send while busy, stop, answer an Agent question and resolve tool/plan approval from either surface. Queue and completion are shared; stale responses cannot execute twice. |
| E2E-MOBILE-04 | Upload a selected image/file, send it, reopen history and save an attachment. Continue image mode with reference images; retry a failed download without regenerating. |
| E2E-MOBILE-05 | Background/reopen Android, change network, restart desktop/app, expire credentials and revoke a grant. Snapshots recover display; drafts survive; uncertain sends never replay automatically; revocation removes access without stopping desktop work. |
| E2E-MOBILE-06 | Inspect actual Electron and Android light/dark EN/ZH screens, small viewport, soft keyboard, Back and attachment picker/save. No clipped input or inaccessible approval controls. |
| E2E-MOBILE-07 | Open a shared conversation, choose Agent/Plan/Goal/Image and select desktop chat/image models. MC follows model → group and shows actual billing; ordinary providers retain source labels. Change reasoning/image options, apply, and verify desktop and phone show the same persisted selection. While a task runs, model/reasoning changes affect the next turn only; mode changes remain blocked. Switching between chat and image restores each saved selection. |
| E2E-MOBILE-08 | Open a shared conversation, close and reopen it, then kill and relaunch the app and reopen it again. The cached transcript renders immediately, the second attach uses `includeSnapshot: false` with the stored cursor, and no `session/snapshot` transcript page is transferred while the cursor stays inside the replay window; live-state refreshes use `session/state`. A cursor past the replay window falls back to one full snapshot. Logout and revocation leave no cached transcript on the device. |
| E2E-MOBILE-09 | Share a session containing a multi-megabyte tool result. The conversation opens without a relay disconnect, the oversized card shows the display-truncation marker with a full-content action, and `session/item` streams the complete item in chunks. Scrolling to the top auto-loads earlier pages; a delegate-produced run renders as one collapsible subagent card and compaction dividers appear at their marks. |
| E2E-MOBILE-10 | Queue two prompts while a turn runs. The queue bar lists both previews; removing one cancels its queued turn, and "send now" on the other promotes it into the running turn (ADR 0265) on desktop and phone alike. |
| E2E-MOBILE-ACCOUNT-RETRY | With an online desktop relay, fail account-sharing publication with 503/Retry-After. The local choice is pending, account pairing cannot run ahead of it, and publication recovers without clicking Refresh. The old service must fail this sequence. |
| E2E-MOBILE-ACCOUNT-OFFLINE | Cache a computer's conversation, quit its desktop, refresh discovery repeatedly and reopen the history. Its directory and messages remain readable, with no additional offline relay tickets or repeated global alert. Restart desktop and confirm live history reconnects. |
| E2E-MOBILE-ACCOUNT-NARROW | Pair an account and independently pair one session, then revoke the account grant. The MC fixture closes the old peer with GRANT_REVOKED; a new peer receives only the remaining session grant. Other computers/cached sessions disappear while the remaining session stays readable after an offline restart. |
| E2E-MOBILE-PAIRING-ERROR | Submit a consumed code in dark English and an expired code in light Chinese. The sheet displays the specific explanation beside the unchanged code; the phone stays signed in and existing grants remain. |
| E2E-MOBILE-tabs-navigate-sessions-activity-me | Sign in, pair and switch between Sessions, Activity and Me. A conversation opens over the tabs, hides the tab bar and Back returns to the list; theme, language, grant revocation and sign-out live in Me. Screens fit 390 and 320 px wide viewports in light/dark EN/ZH with no renderer exception or missing translation key. |
| E2E-MOBILE-attention-push-visible | Keep the phone on another screen while a shared session asks for approval and then completes. An in-app toast, a Needs you row and the Activity badge appear without a system notification; answering on the desktop marks the item handled. |
| E2E-MOBILE-attention-push-background | With the phone backgrounded, run, fail and question a shared session. Smart keep-alive reports the running task; completion, failure and question each raise one tagged system notification with its route, and an answer given elsewhere withdraws it. Tapping a notification opens that conversation and marks it read. |
| E2E-MOBILE-attention-push-scope | Run work in an unshared session, then revoke the share and run again. Neither reaches the phone, and revocation removes the session's inbox entries. |
| E2E-MOBILE-attention-background-vendor-guidance | On a phone reporting a vendor that freezes background apps (OPPO), Activity explains the vendor's switch once notifications are allowed. The notice asks Android for the battery exemption and opens app settings, and it stays dismissed after "I've done this". |
| E2E-MOBILE-attention-background-held-back | Keep-alive runs while the phone is hidden, and the phone reads a completion only on return, about 100 s after the event. Sessions reports that notifications arrived late, with the vendor steps, until dismissed. Prompt background deliveries never raise the notice. |
| E2E-MOBILE-attention-background-native-long | Actual Android: the desktop starts work while the phone rests on Sessions. The phone leaves the foreground with the screen off and Doze forced. The keep-alive text follows the task, and the completion is posted as a system notification without reopening the app. |
| E2E-MOBILE-attention-background-native-frozen | Actual Android: the platform freezer (`am freeze`) holds the app and its WebView renderer. No notification arrives and the keep-alive count stays unchanged, as on vendor ROMs. On return, the app reports the held-back delivery, and Android's battery exemption dialog adds it to the allowlist. |

Use isolated profiles, actual Electron, an Android emulator/device and controlled
model upstream. The PI MC relay fixture is an external-boundary test service;
record MC-team service acceptance separately after that implementation arrives.
Keep APKs, screenshots, profiles and reports outside Git. Record the executable
candidate, base main, commands, evidence directory and any unverified scenarios.

Executable suites and prerequisites are documented in
`apps/desktop/test/e2e/mobile/README.md`.
`acceptance.mjs` uses actual Electron and a touch browser; `android.mjs` uses
actual Capacitor secure storage, Android picker/share, Back, IME and app restart.
Full desktop restart retains the existing interrupted-plan semantics; mobile
reconnect while desktop remains running restores actionable pending plans.


## MirrorCoding local acceptance

### Gemini relay binding regression

Run `node --test apps/desktop/test/mirrorcoding-gemini-session.test.mjs`.
Set `PI_DESKTOP_HOST_BIN` to a compatible existing Host executable to also run
the native process scenario; without it that scenario is explicitly skipped.
Reuse the installed Node/Electron dependencies instead of installing a second
environment. Evidence and fixture state remain under ignored `.artifacts`
directories in the request worktree.

- Start at the real session-launch resolver, serialize its provider config,
  and send using the actual pi-ai Google SDK through the loopback relay to a
  controlled account endpoint. Complete a first reply and follow-up with
  `gemini-3.8-flash`; preserve the preceding reply in the second request.
- Preserve custom headers, replace a stale mixed-case local binding header,
  and verify credentials remain nested in `provider.headers`.
- Exercise Google's native API-key header without the explicit header. Reject
  missing, unknown and invalidated keys, including an invalid explicit key
  alongside a valid Google key. Relaunch after invalidation with a fresh key.
- Verify only the intended encoded group and declared Gemini streaming route
  reach the account boundary; local API keys and custom headers do not leak.
- With an isolated real Rust Host and Node Agent Sidecar, create a session,
  begin an Agent turn, read a fixture file through the real tool dispatcher,
  receive a final reply, and submit a follow-up. Confirm the tool result and
  previous reply enter the subsequent Google requests, with no error events.

This scenario validates launch/serialization, SDK HTTP, Agent execution and
native persistence. It does not claim live paid-provider, OAuth-consent UI,
packaged-installation or released-build acceptance.

### Broader account acceptance

Run the MirrorCoding suites on the dedicated task candidate incorporating the
latest `origin/main`; record candidate/base revisions and the artifact directory.
Do not merge into local main for validation.

- `apps/desktop/test/e2e/mirrorcoding/acceptance.mjs`: actual Electron window,
  Edge consent against a local MirrorCoding server, actual Rust/Node runtime,
  controlled HTTP/SSE upstream. Covers centered welcome/confirmation, skip and
  restart, Account settings, model→group selection/prices, four protocols with
  reasoning parameters, tool continuation, inherited subagent, auxiliary calls,
  429/503, interrupted output/Continue and scoped logout.
- `apps/desktop/test/e2e/mirrorcoding/recovery.mjs`: account/relay service workflow
  with real Rust persistence and controlled local OAuth/HTTP faults. Covers
  concurrent rotation, PKCE, cancellation/timeout, network/empty catalogs,
  permission refresh, group encoding, SDK auth stripping, stop propagation,
  account reuse/switch and offline revocation retry.

Keep screenshots, reports and isolated profiles outside Git. Production origin
verification requires a separately authorized run; local acceptance is not
production deployment evidence. See the suite README for prerequisites.
### E2E-EXTENSION-thinking-request-state

Set high thinking through the production extension bridge, send a prompt and
capture the provider stream options. The actual Agent loop sends high, matching
the extension getter. `runtime.test.ts` mocks only the provider stream.

### E2E-TRANSCRIPT-full-read-cache-race

Hold a full-history read, publish a newer streaming snapshot, then resolve the
old read. The caller receives history while the session cache keeps the newer
snapshot. Coverage: `full-transcript-refresh-race.test.mjs` plus existing
session-runtime update regressions. No provider execution is required.

### E2E-SESSION-rejected-stop-state

Reject a remote Stop at the API boundary: the production session slice keeps
its running state and rethrows the error. Retry successfully: both the active
indicator and owning session running entry clear. Coverage:
`failed-session-stop-state.test.mjs`, without provider execution.

### E2E-SUBAGENT-system-notice-reconstruction

Reconstruct a transcript with a running Task followed by a system notice.
The production entry builder, live-delegation selector and outcome resolver
keep the Task running. End the session or add a new ordinary prompt and verify
that historical Tasks are no longer live. Coverage:
`live-delegation-system-row.test.mjs`; `turn-process.test.mjs` checks the
matching turn boundary and `turn-process-header.test.mjs` the rendered labels.

### E2E-STEERING-recovery-reply-order

Feed consumed steering between an earlier reply and the next recovery response.
The earlier reservation settles and the next reply gets a new ID. Cover
provider, overflow, silent and progress recovery in `runtime.test.ts`.
`e2e-transcript-render.mjs` verifies production event projection and the
existing one-bubble overflow recovery when no steering is consumed.

### E2E-COMPOSER-screenshot-without-directory-scan

Paste a native folder, then a synthetic screenshot through real Composer,
preload IPC and the bounded scratch writer in `e2e-composer-paste.mjs`.
Run with `--screenshot-only` to verify the folder and screenshot route while
excluding unrelated MP4 preview. Screenshot metadata never enters native
directory discovery; scratch bytes are verified exactly in Main.
`composer-directory-paste.test.mjs` verifies byte preservation and existing
folder/mixed-selection behavior. No system clipboard contents are changed.

### E2E-FILE-MANAGER-git-deadline

`file-manager-git-timeout.test.mjs` drives actual bundled `fm.list` and `fm.read`
against real fixture files with a controlled child-process boundary. Advance
the Git deadline while the child never closes: entries and preview complete
without Git metadata. Existing Electron directory-location and mutation
journeys cover successful reads, saves and directory browsing.


## E2E-MC-native-response-recovery (2026-09-29)

Run apps/desktop/test/e2e/mobile/response-recovery.mjs with the documented mobile
acceptance prerequisites. Use isolated Electron, Rust, Node, a phone-sized browser
and the local MC authorization/relay fixture, never production credentials.

- Pair desktop/mobile; send an MC Claude model advertised as OpenAI. Verify
  /v1/messages, exact ID, selected encoded group, Bearer and no SDK API key.
- Send max using the configured capability mapping; do not inject a budget.
- Normal thinking-only stops once, remains visible and offers Continue.
- Restart desktop, reconnect phone, Continue; keep prior thought/native replay,
  append a user message and preserve an unsent mobile draft.
- Explicit length is truncated; missing message_stop is interrupted; empty
  succeeds only within the single-empty retry budget. Keep partial content.
- Desktop Continue reaches the phone; phone Stop cancels without replay.
- Inspect English/Chinese light/dark error cards, thought disclosure and buttons.

The native runtime suite additionally checks completed-tool context, unsigned
thought exclusion, unfinished tool suppression and infinite-retry boundaries.
The provider recovery Electron suite checks real pre-output network backoff,
post-output interruption followed by explicit Continue, and tool-round budgets.
Record actual passed assertions and screenshots separately from production
MC/Kiro testing; do not claim the latter from controlled fixtures.


## MC client-management and Fast acceptance (2026-09-30)

Use the task worktree with rebuilt packages, Rust host, desktop and sidecar bundle.
The controlled mobile browser and PiMobileQA Android suites exercise login,
pairing, streaming, next-turn model/group/Fast selection, queued execution,
desktop-to-phone updates, image requests and restart. Capture the real outgoing
Chat/Responses payload at the local MC boundary; Fast-on sends service_tier fast,
Fast-off, image and auxiliary requests omit it. Inspect both model panels in
actual Electron and Android WebView screenshots.

Switch from Fast-on model A to a different Fast-capable model B in desktop and
mobile. B starts off, the next request omits service_tier, and manually enabling
Fast again sends the field. Changing groups also resets it; reasoning-only edits
do not. Canceling mobile selection leaves the saved setting untouched. Check
that desktop shows a solid lightning icon instead of visible requested-Fast
text, keeps the tooltip and accessible request wording, and removes the icon
when Fast is off or image mode is active. Retain light/dark and narrow screenshots.

Complement these user paths with catalog/group/endpoint fixtures, Rust persisted
configuration checks and real controlled HTTP child/tool-continuation checks.
Verify denied Fast never falls back; no Claude-name route survives. Record the
commit, remote base, suites and local-versus-production boundary in Summary.md.
#### E2E-260: Windows updater cache can be relocated and reclaimed safely

- **Preconditions:** Packaged Windows x64 NSIS install, isolated user profile, and a writable cache directory on a non-system volume. Use a local updater-feed fixture; do not contact GitHub or a paid service.
- **Steps:** 1) Seed the legacy `%LOCALAPPDATA%` updater cache with `installer.exe`, `current.blockmap`, and a staged update. 2) Launch with `PI_DESKTOP_UPDATE_CACHE_DIR` set to the isolated cache base. 3) Confirm Main adopts the baselines and staged update into the configured cache and removes the legacy cache. 4) Complete the staged update and launch the new version. 5) When the fixture reports no newer version, inspect the configured cache.
- **Expected:** `app-update.yml` determines the cache subdirectory; the pending update and differential baselines survive relocation; when the running version is current only `pending/` is removed, while `installer.exe` and `current.blockmap` remain for the next delta. The default path remains unchanged when the override is unset. The app does not write the download into `Program Files`.
- **Specs:** `03-runtime/07-process-model.md`, ADR 0022.
- **Acceptance:** Cache-path, migration, and cleanup unit tests pass; Windows task-candidate validation confirms the updater feed transport, installer handoff, and filesystem behavior without a live release feed.
- **Milestone:** M6+
- **Status:** Unit and source-contract covered (`update-cache.test.mjs`, `auto-update.test.mjs`); Windows installer/E2E validation remains required.


## E2E-Mobile-account-offline-20261006

Use `apps/desktop/test/e2e/mobile/account-sync.mjs` with isolated Electron/Rust
profiles, the controlled MC fixture and the real mobile browser application.
Never use production accounts or paid models for these scenarios.

1. Enable account sharing on two computers and claim one eight-digit code.
   Verify separate computer/project/session trees, empty projects, ungrouped
   sessions and same-path isolation. Discovery must transfer no history bodies.
2. Load 610 messages, return to the list, disconnect MC and reload the phone.
   Read every loaded page from IndexedDB without another history request.
3. Stop one desktop, edit an old message, delete another and append a reply using
   the real Rust host, then restart. Reconnect the phone: only those three changes
   cross the relay, no full snapshot/history; edited/deleted rows remain correct.
4. Opt in a third computer without another pairing, then opt out only one machine.
   Preserve other grants and continue showing offline cached directories.
5. Add a single-session grant, revoke the account grant, and reopen offline.
   Only that session remains, its loaded pages still work, and other content is
   removed. Revoking the remaining grant clears its directory and cached history.
6. Exercise an oversized multi-block tool message through changes/history and
   full-content expansion. Sync position advances while the complete item remains
   accessible through chunked session/item, then readable from the offline cache.

Native update acceptance uses PiMobileQA with controlled HTTPS/localhost feeds:
check while signed out, download/cancel/retry, resume status after process restart,
open the unknown-source permission screen, return to the installer and cancel or
complete installation. Covering upgrades keep identity, credentials and cache.
Record native screenshots separately from browser results. The account-grant MC
increment and production update publication require later service validation.

#### E2E-CHAT-subagent-direct-stop

- Environment: isolated Desktop profile, real Main/sidecar/Host and a local
  streaming provider fixture; no real API account or user data.
- Start two delegates, open A's detail panel and stop A. Verify B and the parent
  remain active, A's partial output remains readable, and no model request was
  needed. Stop all from the group header; B stops and the parent remains active.
- Terminal cards remove their Stop controls and persisted Task snapshots record
  `stopped`. An empty explicit ID list is rejected rather than stopping all.
- Run `node scripts/e2e-subagent-stop.mjs`. Runtime tests additionally cover
  cross-session isolation and uncooperative cancellation remaining pending;
  `e2e-subagent-parent-error.mjs` covers explicit cancellation/resume semantics.


## Delegate mutation recovery isolation

- Start two Task delegates editing the same file. Delegate A produces text and
  fails three Edits; B fails twice and then completes. A is failed with
  `MUTATION_RETRY_BUDGET_EXHAUSTED`, B completes, and the parent has no mutation
  error. Resume A with a corrected task and verify successful completion.
- Run the same flow with failing shell patch commands. Repeat with one delegate
  to prove that text preceding exhaustion does not become a completed report.
- While a delegate continues, a new parent prompt resets only the parent's
  recovery counters. Both default and explicit delegate permissions retain the
  same isolation.
- Automated provider-boundary flow: `node scripts/e2e-subagent-edit-isolation.mjs`
  with optional `--single` and `--patch`; runtime tests cover parent restart.



## MirrorCoding account benefits (client candidate)

- Show the fixture wallet balance to the left of the bar, separately from plan
  quota. Open wallet confirmation with pointer and keyboard; Cancel/Escape must
  not navigate. Confirm opens only the fixed wallet URL. Browser-open failure
  stays visible and can be retried. Account change closes the old dialog.
- Hide the bar for no plans, expired/exhausted plans and remaining CNY 0.50 or
  below. A single plan above CNY 0.50 qualifies; multiple smaller plans do not.
  Unlimited active plans qualify. Missing wallet/conversion fields show unknown
  balance and hide finite bars, without disabling check-in in Account settings.
  A disappearing bar closes its open popup; recover through Account settings
  without an unanchored overlay covering the composer.
- Authorize a fixture account, inspect the real composer bar before the model
  picker, hover for percentage, open all active subscriptions and verify
  quota/expiry/reset/groups. Expired entries are omitted. Closed bar has no text.
- Click daily check-in once; show the day's wallet reward and disable repeat
  action. Wallet balance refreshes; subscription quota remains separate. Repeated main calls share
  pending work; an account switch cannot redirect a queued check-in.
- Change finite usage through green/yellow/red, exercise no plans/unlimited,
  and force 401 refresh, permission denial, unavailable server and network
  failure. Unknown data is never fabricated as zero or retained as current.
- Validate fixed popup anchoring, unchanged toolbar geometry, viewport bounds,
  dark/light themes, narrow windows, keyboard open/Escape and logout cleanup.
- Automated: `node scripts/e2e-mirrorcoding-benefits.mjs` uses the actual
  composer, account service and IPC handlers with local HTTP fixtures. It
  replaces preload transport/credential storage and runs Chromium, not a
  native Electron or live-server certification. Service regressions live in
  `apps/desktop/test/mirrorcoding-benefits.test.mjs`. Artifacts are retained
  under `.artifacts/account-benefits/`.
- Live website/Pi reward parity, server consent, cross-device idempotency,
  Turnstile policy and server-day rollover remain required server acceptance
  once the contract is implemented and a QA account is authorized.


## MirrorCoding first-use image generation (0.20.2)

- Authorize a fresh account against the controlled catalog with both manual
  image settings unset. Without visiting Image mode or Settings, submit a chat
  request; verify ListImageModels followed by GenerateImage, a visible persisted
  image and unchanged manual settings.
- Then exercise manual model/group selection, explicit image references,
  unsupported references, cancellation, download retry, restart and sign-out.
- Select Agent, Plan, Goal and Image through the shared single-chip menu;
  opening the chip must not itself change the committed mode.
- Runner: apps/desktop/test/e2e/images/acceptance.mjs. Real Electron/Rust/agent
  wiring uses only a local HTTP provider fixture; it is not paid-provider QA.

### Agent image results outside collapsed process details

- Authorize a fresh isolated desktop against the local image catalog. Ask the
  chat Agent to generate an image without opening Image mode. Wait for both
  the saved `GenerateImage` result and the final reply; leave the automatically
  completed process collapsed. Its image must be visible in the reply area.
- Expand the process and its tool group, then collapse it. Exactly one result
  card remains outside those disclosures. Open/close the preview, save the PNG,
  and add it as a reference while preserving an existing draft. Repeated use
  of the same reference does not duplicate its chip.
- Reload and restart, select the original conversation, and verify that its
  saved image remains visible without another generation request. Inspect
  dark/wide and light/narrow layouts and retain screenshots.
- Select a separately configured chat/image provider and generate two images
  through `GenerateImages`. Its existing single gallery and two thumbnails
  remain visible when collapsed and are not duplicated when expanded.
- Driver: `pnpm test:e2e:agent-image-result`
  (`apps/desktop/test/e2e/images/agent-result.mjs`). Uses the real desktop,
  preload, Host, Agent and filesystem with local model/account fixtures only.
  `PI_TEST_PLAYWRIGHT`, `PI_TEST_ELECTRON` and `PI_DESKTOP_HOST_BIN` select the
  existing host toolchain. `PI_TEST_OUTPUT` selects an isolated evidence/profile
  directory; it must be new for each run. Artifacts are retained for review.


## Codex native import (2026-10-25)

| ID | User path and expected result |
| --- | --- |
| E2E-CODEX-ENTRY | First launch shows the pinned Sidebar card above chats without scanning; both Sidebar and Project archive open one wizard. |
| E2E-CODEX-DISMISS | Cancel/Escape restore focus and visibility; current-run dismissal survives navigation/reload but not restart; permanent dismissal survives restart; Settings restores it. |
| E2E-CODEX-SELECT | Scan a controlled directory, select one conversation, import, inspect its native history; no default select-all and no source modification. |
| E2E-CODEX-CONTINUE | Native import, controlled-model follow-up, actual read/write, Host/runtime restart and another follow-up retain effective context; historical tools never execute. |
| E2E-CODEX-COMPLEX | 301 candidates, paginated DB plus rollout, fork chains, rollback/compaction, Chinese, images, incomplete/unknown records and missing files with explicit partial-context confirmation. |
| E2E-CODEX-LIFECYCLE | Cancel one batch and retry with a new identity; completed imports survive and duplicates never overwrite PI work; missing cwd blocks execution until bound. |
| E2E-CODEX-VISUAL | Production Sidebar/import components in isolated Electron, compiled themes, narrow dialogs, independent list layout, keyboard focus and retained screenshots. |
| E2E-CODEX-PARTIAL | Incomplete sources expose one continuation action above collapsed details; retain available context for one or several items. No individual or bulk history-only action exists. Missing context explains source repair without creating an empty-context conversation. Completed selections clear. |
| E2E-CODEX-SEGMENTS | Stream Zstd segments, distinguish physical bases from logical threads including matching initial IDs, and import multiple forks without inherited-message collisions. |
| E2E-CODEX-REAL | With explicit user authorization, read actual local source into isolated storage; import current and affected conversations, restart, skip duplicates, and inspect full AppShell list/review/open at normal and narrow widths. Capture continuation only at a controlled loopback endpoint with new tools confined to a fixture directory. Never commit private artifacts. |

Commands and coverage boundaries: [Codex import validation](../../testing/codex-import-validation.md).


### E2E-REMOTE-FILE-MANAGER: Scoped remote plugin reads

Run `node scripts/e2e-remote-file-manager.mjs` to validate the shipped copy in
`apps/desktop/resources/plugins/pi.file-manager`. This is the release acceptance
path: passing against a separate development plugin does not prove the bundled
user path is repaired. The runner records the loaded directory in its output.
An optional `<built-file-manager-directory>` argument selects the companion
plugin's rebuilt `views/` or unpacked official PluginPack artifact for development
validation only. Before accepting #1711, update the bundled release, its upstream
tag/commit and per-file checksums, then rerun the default path on the updated PR
integration candidate.

A development integration may exercise a Desktop hotfix in that actual bundled
directory, with its immutable source commit, local patch and artifact checksums
recorded honestly in `UPSTREAM.md`. A passing hotfix journey does not claim that
the companion upstream release or the maintainer's final acceptance is complete.
`PI_FILE_MANAGER_QA_DIR` may point to an existing plugin `tests/electron`
installation providing Playwright; `PI_ELECTRON_BINARY` selects an existing
compatible Electron runtime. `PI_E2E_ARTIFACTS` optionally preserves screenshots.

The isolated production plugin process and `file://` view use Desktop's actual
SDK broker, durable-binding reader, loopback RACP transport and Host filesystem
service. Only the fixture's project-record lookup and authentication bootstrap
are supplied by the harness. The remote fixture root is registered explicitly
outside the Host folder picker's browse root. Verify nested listings,
text/image bytes, hidden credentials, read-only editor/save/menu controls,
visible disconnect errors and refresh recovery, rejected late previews and
ancestor opens after a project switch, and restored local
editing/Browser/editor detection. No model, user profile or external SSH server
participates. Real SSH transport and native Windows/Linux behavior require
their separate platform acceptance.

### E2E-GENUI-inline-visualization-card: a visualization renders inline and stays sandboxed

- **Preconditions**: The app is running with a local Agent session, Settings →
  AI → Inline visualizations switched on, and the builtin
  `pi-desktop/visualize` skill enabled. A second session uses a remote
  workspace.
- **Steps**: 0) With the switch off (the default), ask for a chart and confirm
  no directory, skill, or card appears; then switch it on. 1) Ask for an
  interactive chart (for example "show a slider that
  changes a sine wave's frequency"). 2) Wait for the turn to finish, then drag
  the slider. 3) Switch the app theme between light and dark. 4) Press the
  card's expand button, then Esc. 5) Ask the model to write a non-`.html` file
  into the visualization directory, and to write a fragment that calls
  `fetch("https://example.com")`. 6) Fork the session, then delete the source
  session. 7) Repeat step 1 in the remote session. 8) Relocate the data directory,
  then fork a transcript that still names its old visualization path. 9) Try
  redirected visualization roots and a `.html` FIFO, and open two document
  URLs from callers that omit the iframe sandbox. 10) Expand a card while
  eight inline cards are live.
- **Expected**:
  - No permission card appears for the fragment write. While streaming, the
    reply shows plain text; after completion the `::visualize` line is
    replaced by a card whose height fits the content (at most 2000 px).
  - The slider works; theme changes recolor the card without a reload.
  - Expand opens a large modal copy; Esc closes it and the inline card keeps
    its state.
  - The non-`.html` write fails with a tool error; fetch requests are blocked,
    and the frame cannot open popups or navigate remotely. The ADR's WebRTC
    ICE limitation remains explicit rather than a blanket no-network claim.
  - The fork retains its own card after the source session is deleted, including
    a fork made after data relocation. The source's directory is removed.
  - Redirected roots cannot bypass Ask write confirmation or let cleanup delete
    unrelated data. FIFO requests fail without blocking other filesystem work.
  - Every document response enforces an opaque sandbox; a caller that omits
    iframe sandbox cannot read another session's DOM.
  - Expanded and inline frames share the eight-frame quota, and the expanded
    card's original inline control state remains unchanged.
  - The remote session gets no visualization directory or skill.
- **Coverage**: `pnpm test:e2e:gen-ui` runs the offline Electron card journey,
  including real protocol responses, bundled assets, the preloaded `viz`
  helpers (`viz.chart` sizing, `viz.render` charts and their date, year,
  re-render, and donut edge cases), a fragment script error shown in the
  card, the fragment inside the kit's `#widget` container with its top-level
  blocks spaced while inline controls, block styling, wrapped roots, and flex,
  grid, and column roots keep their geometry, focus/guest Escape,
  viewport release, and unsandboxed callers through a real isolated Host.
  Native directory, FIFO, and ABA regressions run in `visualizations/files`;
  `gen-ui-file-safety.test.mjs` validates the private Host-to-Main boundary.
  Rust visualization RPC/lifecycle/fork tests
  cover authorization, deletion safety, Windows path spelling, and relocation.
- **Status**: Automated without a paid provider or a user's running instance.

#### E2E-PROVIDER-reasoning-effort-override: Preserve an explicit gateway reasoning parameter

- **Setup:** A custom Chat Completions provider with a DeepSeek-family model;
  start with a legacy binding that omits `supportsReasoningEffort`.
- **Steps:** In English, Chinese and German at 850/1000/1400px widths, open model settings, confirm Auto, select
  Send, save and reopen; repeat for Do not send and Auto. Switch to Responses
  and Anthropic and confirm the Completions-only control is hidden.
- **Expected:** Each saved binding retains true, false, or null respectively.
  With High selected, the real Completions adapter sends `reasoning_effort: high`
  only when enabled; Auto keeps the existing DeepSeek compatibility default.
  Responses continues using its own reasoning contract. Provider creation,
  update/read, copying, and sync preserve the explicit override.
- **Automation:** `node scripts/e2e-provider-api-style.mjs --reasoning-effort` exercises real
  React/Chromium controls and captures the Host API payload (the IPC boundary is
  stubbed). Rust provider tests independently verify real SQLite persistence;
  `provider-reasoning-effort.test.ts` captures requests from the real pi-ai
  adapter with fixture SSE responses. No live gateway credentials are required.


#### E2E-RUNTIME-malformed-tool-call-continue-recovery: Continue after malformed tool output

- **Preconditions**: An isolated sidecar and loopback Responses fixture can
  emit an empty tool name, then a corrected Read call. Unit fixtures also
  cover missing names/IDs, empty Responses wire IDs, non-object arguments,
  retained malformed context, compaction tails and resumed delegates.
- **Steps**: Return one malformed response, then invoke the same `agent.prompt`
  entry used by Continue three times. Repeat with three consecutive malformed
  responses followed by a corrected response. Keep the runtime alive throughout.
- **Expected**: Each malformed batch settles with one local
  `context-validation` error before tool execution, with no transport retry.
  All three later prompts complete; the corrected Read executes once, and the
  runtime is reused rather than restarted. Model context retains valid history
  and system updates while excluding malformed calls and associated results.
  Optional usage estimation does not lose terminal tool events. The durable
  transcript and Host permissions are unchanged; unrelated malformed hosted
  search still fails strict validation.
- **Specs linked**: `03-runtime/02-agent-runtime.md` §5d.
- **Acceptance**: Conversation, runtime recovery and quality.
- **Milestone**: M5 hardening.
- **Automation**: `pnpm test:e2e:hosted-search` runs the production sidecar and
  real Responses adapter against synthetic SSE, including one-error and
  three-error recovery cases. `malformed-tool-recovery.test.ts`,
  `tool-call-identity.test.ts` and `subagent.test.ts` cover retained state,
  event/result agreement, batch rejection and delegate restoration.
- **Status**: Automated offline; native UI clicking and live providers are
  outside this fixture's coverage.

### E2E-PLUGIN-PROJECTS: Enumerate durable projects without switching workspace

- **Preconditions**: An isolated Host profile with a standalone project and a
  multi-folder group, plus a session with no project. A plugin with no granted
  permissions registers a command that calls `pi.projects.list()`.
- **Steps**:
  1. Run the command through the plugin process and read the same list through
     the panel bridge's `projects.list` channel.
  2. Compare the entries with the Host's durable `projects.list` rows and group
     roots, and verify that the visible workspace remains unset.
  3. Restart the Host and run the command again.
  4. Stop the Host and run the command again.
- **Expected**: Exactly one entry per durable row, including ungrouped and
  secondary-folder rows; non-empty decimal database ids; most recently opened
  first regardless of pins; every entry has its own primary path first in
  non-empty roots. A primary group row includes its additional roots in order.
  Identities survive restart. No workspace is opened or switched, no filesystem
  grant is added, and a stopped Host returns `[]`. No Host credentials appear.
- **Automation**: `pnpm test:e2e:plugin-projects` runs a real isolated Rust Host
  and plugin child process without provider calls. The companion
  `apps/desktop/test/plugin-projects.test.mjs` covers pin-independent ordering,
  group lookup failure, missing project providers, failed/malformed lookup,
  rename identity, and stale results after Host replacement.

### E2E-268: Plugin launcher grid, triggers, and local applications

- **Preconditions**: An isolated Host profile with a panel plugin that declares
  one launcher trigger (for example `^\d+\s*[\+\-\*/]\s*\d+$`, so `1+1` matches
  it) and whose panel renders the text it received through
  `window.pluginBridge.consumeLauncherPayload()`. A second panel plugin with a
  Latin name, and at least two installed applications, one of them Chinese with
  a `wx` / `weixin` / `微信` spelling chain. Run on Windows and macOS.
- **Steps**:
  1. Press `Alt+Space` (`⌥+Space` on macOS) with an empty input. Read the grid:
     group titles, rows, tiles per row, and the two header actions.
  2. Type the trigger expression `1+1` and inspect the first tile and its detail
     line; press `Enter` and read the opened panel.
  3. Reopen the launcher and type a pinyin initial such as `wx`, then `weixin`,
     then `微信`; confirm the same application is the matching tile each time.
  4. Type `pi` and confirm the plugin named `PI-Desktop` is listed with a name
     match, and that the same item is reachable by pinyin and initials.
  5. Drag the panel's edge to a larger and then a smaller size; count the tiles
     per row at each width. Quit and restart the application, then reopen the
     launcher.
  6. Type a query that matches more than 24 items. Read the header action and
     the window height.
  7. Disable one plugin that was in recents/pins, reopen the launcher, and check
     the empty-input view and a query that used to match it.
  8. Paste 500 characters of garbage into the search field.
  9. Pin an application, quit, restart, and reopen the launcher with an empty
     input.
 10. Install a plugin whose name matches an installed application (for example
     `Calculator`) and open the launcher with an empty input.
- **Expected**: Step 1 shows `Recently used` with two rows of eight tiles and
  `Pinned` with one row of eight once the user has pins; the recents header
  reports the true number of remembered items and offers `Show all {count} →`
  plus `All plugins →`. Step 2 lists the trigger plugin as the **first** tile,
  ahead of name matches and without a detail line, and the panel shows `1+1`
  exactly once (a second read returns `null`). Step 3 reaches the same
  application through all three spellings. Step 4 lists `PI-Desktop` once by
  name. Step 5 keeps eight columns per row at every width, the panel height
  always matches what it renders, and the dragged width is restored after the
  restart. Step 6 keeps the window at its height cap, reports the dropped count
  in the header, and asks the user to keep typing. Step 7 removes the disabled
  plugin from recents, pins, and matches while every other tile still opens.
  Step 8 keeps the panel responsive (no frozen input, no unhandled error) and
  reports no match, because input longer than 256 characters is never matched
  row. Step 10 lists both entries with the identical 48px rounded square and the
  same name line — the source is only in the hover title — and opening the plugin
  row still lands in the plugin panel while the application row launches the
  program.
- **Automation**: `pnpm --filter @pi-desktop/desktop test` runs the offline
  coverage for these rules: `launcher-search.test.mjs` (ranking order, section
  caps, overflow total, trigger whole-input matching, the 256-character limit
  and the all-plugins view), `launcher-store.test.mjs` (pins and the eight-pin
  cap, recents, legacy migration, retired fields read without error, and
  pruning), `plugin-launcher-height.test.mjs` (content-height arithmetic and
  clamping), `local-apps.test.mjs` (discovery, bounds, icon budget and icon
  cache, dropped targets, opaque-id launch) and `plugin-launcher-state.test.mjs`
  (clamping and re-centring). Rust `plugins` tests cover the manifest rules. The
  rendered Electron journey above — grouped grid, content height, resize,
  restart, and the panel payload round trip — is Draft until a launcher E2E
  script exists.

## Interrupted provider response continuation (2026-10-23)

Run `node scripts/e2e-provider-recovery.mjs` against the task candidate with
an isolated profile and the local HTTP/SSE fixture. `PI_E2E_ELECTRON` and
`PI_DESKTOP_HOST_BIN` may reference the host's existing development binaries.
Retain screenshots, requests, durable messages and lifecycle events.

- Send through Chat Completions, receive partial text, disconnect, and recover
  without clicking Continue. Prior text remains; no terminal error appears.
- Send through Responses, receive reasoning, then `upstream_stream_read_error`
  or `basispoint request timeout`. Both automatically recover, retain reasoning,
  and persist only the user's actual submission, with one terminal lifecycle.
- Recover setup failures, exhaust the finite budget and manually Continue once,
  and complete eleven successful tool rounds with separate transient outages.
  Completed tools are not replayed and their results remain in the final request.
- Click Stop during a partial-stream retry wait: preserve the fragment, settle
  the turn once, and issue no second model request. Expect the existing
  `TURN_ABORTED` cancellation event, no provider error card, and an idle editable
  composer. Dismiss onboarding through its normal Skip control before taking
  unobscured screenshots.
- Runtime user-path tests additionally cover session/delegate/one-shot owners,
  native Messages signatures, unfinished tool arguments, stalled streams,
  cancellation during recovery, infinite retry beyond the finite budget,
  shared setup/stream budgets, and permanent authorization failures.

No live model endpoint, account, server deployment or active user profile is used.
