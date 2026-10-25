# Desktop 0.21.0-beta.4 package candidates

Date: 2026-10-19. These are test packages, not a published release.

## Source and scope

- Fork base: `5f272b38bf540251263623f8b94818545d94f78b`.
- Upstream base: `589e5803a7a9f4ebf7ec1e8849c43e44b4a198f7`.
- Integrated application source: `1472e0b9655de45143cd33f1ee4478b442ecd054`.
- Package workflow and probe: `fc537a949e7c1c33404ec87310ff2a2d9dab2a66`.
- Dedicated branch: `codex/package-desktop-20261019`.
- Desktop remains at the integrated upstream version, `0.21.0-beta.4`.
- Android remains at `0.20.4`; no mobile package is built.
- No main update, tag, GitHub Release, server change, or automatic-update
  metadata publication is part of this task.

The application includes the preceding upstream integration, selected-text
references, temporary side chats, compact reference controls, and account
benefits UI. The account benefits endpoints and grants remain server-owned;
packaging does not make an unavailable server endpoint available. See
`../upstream-sync-20261019.md` for the integration and its validation.

## Build outputs

### Windows x64, built locally

| Package | Bytes | Purpose |
| --- | ---: | --- |
| `PI-Desktop-Setup-0.21.0-beta.4.exe` | 113103417 | NSIS installer |
| `PI-Desktop-Portable-0.21.0-beta.4.zip` | 157851005 | ZIP distribution |
| `PI-Desktop-Portable-0.21.0-beta.4.exe` | 101047306 | Portable executable |

Build outputs remain under `apps/desktop/release/windows-nsis`, `windows-zip`,
and `windows-portable`. Delivery copies are outside the repository in the
local `PI-Desktop-packages/0.21.0-beta.4-20261019` directory. The installed,
ZIP and portable packages retain their respective distribution metadata.

The local build reuses the host dependency environment and Rust caches.
It builds the workspace, bundled agent runtime, production Electron UI, and
native Host before electron-builder packaging. No user-profile migration
is performed. A later pnpm convenience-command invocation unexpectedly
started dependency setup and was stopped; the actual check was then run
directly with Node. Missing dependency links in the task worktree were
restored by reference without removing files. The already-built packages
were not modified.

### macOS arm64 and x64, built by GitHub Actions

Workflow: `.github/workflows/macos-package.yml`.
Run: https://github.com/AR307/PI-Desktop/actions/runs/39215261423

Each architecture uses a native macOS runner, Rust 1.90.0, Node 24, a locked
pnpm install, workspace build/typecheck, native Host build, and Electron
packaging. The lane has read-only repository permission and does not publish.
It uploads DMG, ZIP and generated metadata as Actions artifacts for 14 days.
These packages are unsigned and not notarized: there are no Apple signing
or notarization secrets configured for this fork.

Both native jobs and the entire Actions run completed successfully.
Both packaged boot probes passed, including Host protocol 11 and all 800
seeded sessions. Artifact `12170025593` contains the arm64 DMG and ZIP
(269788563 bytes in the Actions artifact archive). Artifact `12170570421`
contains the x64 DMG and ZIP (278543653 bytes). Actions retention expires
on 2026-11-02; local delivery copies do not depend on Actions retention.

The arm64 DMG is 135204176 bytes and its application ZIP is 134300570 bytes.
The x64 DMG is 139525479 bytes and its application ZIP is 138723309 bytes.

## Validation actually run

- Workspace TypeScript builds, Desktop typecheck, voice-runtime build,
  bundled agent runtime, production Electron build, and release Host build:
  passed on Windows. The renderer build reports a non-failing chunk-size
  warning.
- Windows NSIS, ZIP and portable packaging: all completed successfully.
- Packaged boot probe against the application in each of the three Windows
  outputs: passed. The probe uses the real preload, IPC and bundled Host;
  checks version `0.21.0-beta.4`, Host protocol 11, 800 returned sessions,
  Ctrl+R blocking, and platform menu behavior.
- Real packaged Electron selection/side-chat journey with a local model
  endpoint: all five scenario groups passed. Coverage includes references,
  inherited completed context, tool execution and approvals, concurrent
  main/side operation, immediate steering, edited references, narrow overlay,
  delegated-task cancellation, restart cleanup and compact-width recovery.
- Wide dark and narrow light packaged screenshots were inspected. Side-chat
  input, reference controls, close controls and overlay remained visible.
- Workflow parsing and artifact-only scope, agent policy synchronization,
  PR-base check and diff whitespace check passed.
- Native macOS arm64 and x64 builds, typechecks, DMG/ZIP packaging and
  packaged application/preload/Host boot probes: all passed in Actions.

Each desktop test uses a separate temporary profile and retains evidence.
No test attaches to or stops the user's running desktop/preview.

## Limits and manual acceptance

- The NSIS installation/upgrade wizard and portable self-extraction launcher
  have not been exercised. Boot tests launch the real packaged application
  in each output's `win-unpacked` directory; they are not installer acceptance.
- Production-account image generation in the packaged app is not claimed.
  The attempted local OAuth fixture is intentionally rejected by packaged
  builds, so its catalog wait timed out. The production authorization-origin
  restriction was not weakened. No real account or paid generation was used.
  The previous unpackaged local-provider acceptance is separate evidence,
  not a substitute for manual packaged authorization acceptance.
- macOS manual installation, Gatekeeper handling and interactive acceptance
  remain for users with the relevant hardware.
- No signing certificate is supplied to these local Windows test builds;
  publisher trust and SmartScreen clearance are not asserted.
- Use a backed-up or isolated profile for manual testing. Do not assume
  downgrading after opening existing data is supported.

## Packaging changes

- Add a build-only macOS matrix without altering the signed release lane.
- Add `scripts/e2e-packaged-boot.mjs` to validate the packaged application
  and its own native Host using the existing product boot probe.
- Keep probe data directly in its dedicated temporary boot directory,
  satisfying the existing fixture safety contract without changing
  application permissions or production behavior.
- Update `Summary.md` and this build report.

The first Actions run was canceled after correcting the probe directory
contract. The run linked above uses the corrected probe.
