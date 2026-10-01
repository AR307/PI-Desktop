# Ultra validation record

Date: 2026-10-01. Scope: local candidate only; no live/paid model calls, MC
server changes, push or release.

## Candidate and environment

- Branch: `codex/pi-ultra`, dedicated `pi-ultra/piformc` worktree.
- Integrated 0.15.10 baseline: `f6a9a7521a06791fd33558fb70d3fa0473886bcc`.
- Remote main at refresh: `920b12b8e053165d343a421b3cb8ee93c50a436a`,
  already an ancestor of the baseline.
- Windows, reused Node 24 and dependency junctions; Rust 1.90.0.
- Isolated Electron profiles, local MC relay/model fixtures, Chromium mobile
  web, and the existing PiMobileQA Android emulator. No user profile was used.
- Android runs use the separate `xyz.mirrorcoding.pi.mobile.ultraqa` test
  package. Temporary build configuration is restored after each run.
- Build installed CLIs directly because pnpm auto-install is incompatible with
  this reused dependency junction layout. Rebuild both runtime `dist` and
  bundled sidecar: development Electron loads the former.

## Static and behavioral checks

- Shared Ultra selection: 2 tests passed.
- i18n: 37 tests passed. Mobile: 17 tests passed.
- Desktop configuration, mobile peer/catalog, native reasoning controls and
  delegation contracts: 134 Node tests passed. Updated obsolete source checks
  to reflect the native slider and accepted model/group metadata; actual UI
  acceptance remains a separate requirement.
- Runtime policy, Task wiring, delegation chains/history and mode tools: 352
  tests passed. These include explicit high/max/low capability resolution,
  unsupported-level errors, lifecycle isolation, and existing cancellation.
- `cargo +1.90.0 test -p host-core --locked`: 705 tests passed. The full run
  exposed and then verified the missing Ultra column in session search.
- `cargo +1.90.0 fmt --check`, host build, and Clippy passed. Existing unrelated
  warnings remain for `permissions::Pending.created_at` and a test `guard`.
- Shared, i18n and runtime compilation plus desktop/mobile typechecks passed.
  Electron main/preload/renderer and Android debug APK builds passed.
- Biome passed on task TS/TSX files selected by repository lint configuration
  (six files); this is not a claim that every source file is lint-enabled.

## User-path evidence

`apps/desktop/test/e2e/mobile/ultra-flow.mjs` drives actual Electron controls,
Rust persistence, Node workers and the local model HTTP/SSE boundary. It
checks keyboard End selecting Ultra, phone synchronization, overlapping
same-model and authorized cross-model workers, native wire reasoning,
independent Fast, parent rebind while workers run, completed Task persistence,
exact worker resume, and next-turn-only edits.

The Android harness exercises native Capacitor login/storage, pairing, Ultra
and Fast requests, keyboard, foreground recovery, system picker/upload, image
generation/share/reference use, restart recovery and light/English plus
dark/Chinese screenshots. A complete pre-commit run passed 24 checks with no
WebView exceptions (`.artifacts/ultra-android-second/report.json`).

## Final committed-candidate acceptance

- Tested commit: `c7b6402809dd289970496e7868a4326adf65d481`.
- Base main: `920b12b8e053165d343a421b3cb8ee93c50a436a`, refreshed before the run.
- Electron/mobile-web: **88 checks passed**, no renderer errors or cleanup
  failures. The report records the same commit and clean tree at both ends:
  `.artifacts/ultra-candidate/report.json`.
- Native Android: **24 checks passed**, no WebView errors:
  `.artifacts/ultra-android-candidate/report.json`. Temporary QA application-ID
  and generated dependency paths were restored; tracked Android configuration
  has no residual diff.
- Reviewed actual desktop Ultra-slider, mobile worker and native Android
  model-panel screenshots. Light/English, dark/Chinese, narrow viewport,
  keyboard, focus, image and restart flows are covered by the harness.
- Representative screenshots: `.artifacts/ultra-candidate/desktop-ultra-slider.png`
  and `.artifacts/ultra-android-candidate/android-ultra-panel.png`.
- Desktop style-token validation passed. No task artifacts, isolated profiles,
  synthetic credentials or QA APKs are committed.

This final record is documentation-only; the tested application tree remains
the candidate above. The QA APK targets its controlled local service, not the
production MC environment, and is not presented as a release build.

## Evidence boundary

Controlled responses intentionally emit Task calls. Their overlap proves the
real execution wiring, not a live model's autonomous decomposition quality.
High versus max selection is covered in runtime tests; the controlled actual
HTTP flow uses GPT models with native high. No production MC/Kiro or paid
model quality claim is made.

No installer, portable release, signed production APK or remote publication
is part of this request. Existing non-English/Chinese locales currently use
English Ultra copy. All native model parameters and MC contracts stay intact.
