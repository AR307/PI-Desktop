# Development baseline

Read this before starting any task in this fork. It records which branch is
the current development baseline and how new work builds on it. Machine
setup for the current workstation lives in `DEV-BASELINE.local.md` beside the
primary checkout (untracked; never commit it).

## Current baseline

```text
branch:   codex/new-dev-baseline
parent:   codex/mirrorcoding-new-baseline (107927d31)
created:  2026-09-26
```

`codex/new-dev-baseline` is `codex/mirrorcoding-new-baseline` plus two merged,
validated branches:

1. `feat(desktop): follow fork releases and open cross-model delegation`
   — in-app updates and GitHub feedback point at the `AR307/PI-Desktop` fork;
   MirrorCoding account chat models enter the subagent delegation catalog
   through the local relay binding (`Task.model` cross-model delegation);
   Windows icon fallbacks; new conversations inherit the last in-scope
   session's model and the home composer chip matches.
2. `feat(mobile): transcript cache, delta sync, queue control and UI refresh`
   — on-device transcript cache with cursor-resumed attach, `session/state`
   light refresh, transcript content caps with `session/item` full-content
   reads, queue management (`turn/prioritize`), subagent/diff/compaction
   rendering, per-frame event batching and the mobile UI refresh. Includes
   `fix(composer): let stored bindings drive the draft thinking menu`.

Authoritative behavior specs for the merged work:
`docs/spec/03-runtime/23-mobile-companion.md`,
`docs/spec/03-runtime/02-agent-runtime.md` §Tools,
`docs/spec/03-runtime/13-model-catalog-and-selection.md`,
`docs/adr/mobile-transcript-cache-and-delta-sync.md`.

## Workflow on this fork

- Every request still uses `1 request = 1 branch + 1 dedicated worktree`
  (root `AGENTS.md` applies unchanged in every other respect).
- Until this baseline lands on the fork's remote main, create new task
  worktrees **from `codex/new-dev-baseline`**, not from `origin/main`:

```bash
git worktree add -b <type>/<short-description> \
  ../new-worktrees/<short-description> codex/new-dev-baseline
```

- Do not develop in the primary checkout or on the baseline branch itself.
  Merge finished, validated task branches back into `codex/new-dev-baseline`
  with `--no-ff` merge commits, then delete the merged branch and worktree.
- The primary checkout remains a coordination surface. Branches
  `codex/v2-mirrorcoding-account`, `codex/v2-mobile-contract`,
  `codex/v2-window-plan`, and `codex/branch-sync-subagents` are other agents'
  unmerged work — never modify or delete them.

## Validation quicklist

- JS surface: `pnpm --filter <pkg> typecheck` · package `test` scripts ·
  `pnpm build:js` for cross-package dist consistency.
- Desktop node tests on this toolchain need
  `node --experimental-strip-types --test test/<suite>.test.mjs`.
- Rust host-core: build with the pinned toolchain noted in the local file.
- Known pre-existing failures unrelated to current work:
  `composer-send-state` "single submit slot" source contract and
  `host-runtime` `image-generation-bridge` (environment-specific sidecar
  spawn); verify against the baseline before attributing them to a change.
