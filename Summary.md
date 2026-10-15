# PI-Desktop project summary

PI-Desktop is a local-first AI coding desktop client. The React renderer owns
interaction, preload exposes IPC, Electron Main orchestrates native lifecycle,
Rust Host Core owns persistence and host state, and the Node agent runtime owns
agent execution. Shared packages define cross-process contracts.

## 2026-10-15 — Upstream storage migration draft

- Prepare a storage-only candidate from upstream 2eb333723b; exclude fork releases,
  mobile/account features and private operational artifacts.
- Port first-run/new-directory handling, physical ASAR copying, dangling Windows
  links, junction normalization and normalized project-memory lookup.
- Preserve upstream d815ef15b lock protection, worktree-path relocation and ESM
  build handling; add root-only installation exclusions and focused regressions.
- Document behavior, scope, test commands and evidence boundaries in
  `docs/project/storage-migration-fixes.md`; prepare a local-only PR body.
- Passed 10 directory regressions, 6 native Electron archive/link cases, native
  lock retry, the Rust project-memory regression, and 3 Settings/Host workflows
  including D:-to-C: migration. Reopened Settings screenshots were reviewed.
- Nine TypeScript packages, Desktop typecheck, candidate Host build, focused
  lint/format/policy checks and 85-pair/575-page documentation checks passed.
- Full Desktop build is blocked by a missing esbuild dependency in the reused
  electron-vite environment. Exact-lockfile/package and integration acceptance
  remain pending; this is a local draft, not release or merge approval.
