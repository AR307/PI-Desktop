# Consolidated local preview

Date: 2026-10-01. Application version: 0.15.10.

## Included changes

The dedicated codex/pi-integrated-test worktree includes current fork main
920b12b8e053165d343a421b3cb8ee93c50a436a and the entire completed chain through
c41acccc4002ead0ed1050591db851e8e4faf8a6. MC client-catalog routing, session and
child Fast, response recovery, image generation, Android synchronization and
controls, upstream 0.15.10 fixes, and Ultra collaboration are included.

The MC/Fast, upstream integration and Ultra branch heads are ancestors of this
candidate. Historical pre-rewrite branches are not blindly reintroduced. The
latest completed task is already cumulative, so Git integration is a fast
forward rather than a duplicate cherry-pick or conflicting historical merge.

## Local delivery

Rebuild the compiled runtime and bundled sidecar before launching. Reuse the
installed toolchain and dependencies; keep mutable profiles and outputs local
to this worktree. The visible preview uses the normal MC origin, not a stopped
fixture. No production or paid model requests are part of automated validation.

No push, release, server deployment, permanent file deletion or change to the
primary checkout is included. Final acceptance results follow after the build.

## Final candidate result

- Tested candidate: 9411bb8b2f3d5a27733c32a3b63a723fb23cd0d7.
- Base main: 920b12b8e053165d343a421b3cb8ee93c50a436a (refreshed).
- Shared/i18n/runtime compilation and desktop/mobile typechecks passed.
- Runtime dist and bundled sidecar, Electron and Rust host builds passed.
- Actual Electron/mobile-web acceptance: 88 passed; no renderer or cleanup
  errors. Report: .artifacts/integrated-e2e/report.json. Covers Ultra workers,
  native reasoning, Fast/reset, model/group changes, image flow, approvals,
  history, reconnect, restart and revoked sharing. All model calls were local.
- Normal-origin Android debug APK built and installed successfully on the
  existing PiMobileQA emulator. The native login screen renders without
  acceptance hooks. No production login or model request was submitted.
- The visible desktop preview starts from rebuilt output. Its independent
  profile is copied from the previous manual Fast preview; existing sessions
  are visible, and the formal application profile remains untouched.
- Reopen desktop: .artifacts/user-preview/Start-PI-Test.cmd (close the already
  running test window first). Android artifact:
  .artifacts/user-preview/PI-Mobile-0.15.10-integrated-preview.apk.
- Screenshots: .artifacts/user-preview/desktop-ready.png and android-ready.png.
- Rust retains the existing unused Pending.created_at warning; Vite retains
  existing large-chunk warnings. No whole-suite or live-provider claim is made.
- This final documentation commit does not change the tested executable tree.
