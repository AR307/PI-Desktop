# Codex import candidate validation

## Candidate environment

- Branch: codex/codex-history-import-20261025.
- Base main: 5f272b38bf540251263623f8b94818545d94f78b.
- Windows, Node 22.12, Rust 1.90; reused existing dependencies, Electron and
  Cargo target. The host default Rust 1.86 is below dependency requirements.
- Synthetic source, workspace and application profiles only. No paid API, real
  Codex conversation import, user application instance or source data mutation.

## Executable acceptance

1. `cargo test -p host-core codex_import --locked`: actual source files, SQLite
   projections, native Host session/checkpoint import, duplicate preservation,
   cancellation/retry, root mapping and directory admission. Fixtures cover 301
   candidates, chained history_base, rollback, retained-only context, images,
   missing attachments, malformed and unknown content, mixed projection ordering.
2. Shared `codex-import.test.ts`: IPC request shapes for the user import journey.
3. Runtime `session-context.test.ts`: retained context with no summary and normal
   checkpoint filtering.
4. `node scripts/e2e-codex-import.mjs`: actual Sidebar, import components, real
   Main IPC and Rust Host in a separate Electron profile. Covers both entrypoints,
   cancel/Escape/focus, navigation/reload, process restart, permanent dismissal,
   Settings restoration, selected import and dark/light/narrow screenshots.
5. `node scripts/e2e/codex-import-continuation.mjs`: builds the real sidecar from
   task source, imports native history and captures four controlled Responses
   requests. Verifies effective summary, latest answer and historical tool output;
   excludes replaced history and duplicate summary. Executes two real Host
   read/write tools, restarts Host and sidecar, then continues without replay.

Set PI_DESKTOP_HOST_BIN and PI_DESKTOP_ELECTRON_BIN to existing build binaries
when reusing a shared development environment. Build shared/i18n/runtime packages
first. Test artifacts are retained under artifacts/ and must not be committed.

## Source format reference

Codex source was inspected at 970111f6cb62cc02fe36a82ea7d71b37a2889c97:
codex-rs/history/src/lib.rs, rollout_payload.rs, retained_context.rs, and
codex-rs/core/src/session/rollout_reconstruction.rs. Persisted ordinals,
replacement-history metadata and rollback boundaries are source-format inputs,
not claims of exact runtime equivalence. NekoCodeDesktop's ACP approach was
reference research only; no code was copied.

## Boundaries

The UI suite mounts production Sidebar/import components, not the whole AppShell.
The continuation suite uses production Host/runtime but mirrors Main's completed
message persistence at the Host API boundary. Their combination proves actual
cross-process import/recovery and visible interactions, not a packaged installer
or a full click-to-model-to-transcript journey through every AppShell service.
Native OS directory-picker interaction, macOS/Linux visuals, multi-gigabyte
single-session memory behavior, all evolving Codex event variants and real user
profiles are not claimed as tested. EN/zh-CN are authored; other locales use the
feature's English catalog. Full repository test/build coverage is not claimed.

Earlier UI fixtures omitted Tailwind compilation; those screenshots are not
visual acceptance evidence. The final fixture compiles the actual global styles
and uses production Sidebar. Final candidate commit and artifacts are reported
in the delivery message without staging generated data.

## Checks completed before candidate commit

- Host import integration: 13/13 passed. Native compaction regressions: 6/6;
  existing session import idempotency: 1/1 (one compaction test overlaps).
- Shared import protocol tests: 2/2. Runtime context tests: 6/6.
- Shared, i18n and runtime TypeScript builds; Desktop typecheck: passed.
- Host debug build, clippy all-targets, scoped rustfmt, style-token checks,
  agent-policy sync, diff whitespace check and current-main ancestry: passed.
- Earlier Electron and controlled continuation journeys passed; final exact
  commit journeys run after committing and their paths are in delivery.
