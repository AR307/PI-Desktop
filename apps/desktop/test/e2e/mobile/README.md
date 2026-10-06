# Mobile companion controlled acceptance

`ultra-flow.mjs` extends the desktop/mobile suite with keyboard Ultra selection,
dual-client synchronization, concurrent same/cross-model workers, native wire
reasoning, durable completion, next-turn isolation, parent model changes and
exact worker resume. `android.mjs` also selects Ultra in the native WebView and
checks request parameters and restart restoration. Controlled replies do not
measure a real model's autonomous planning quality.

These suites run the actual Electron desktop with an isolated profile, Rust host
and Node agent runtime. `fixture.mjs` supplies a local MC HTTP/WebSocket boundary
and controlled chat/image upstreams. No production account or paid provider is
used. Run commands from the repository root on Windows.

## Prerequisites and desktop build

Use the repository's Node and pnpm versions, a Rust toolchain compatible with
`Cargo.lock`, installed workspace dependencies, and Playwright with its Chromium
browser installed. `PI_TEST_PLAYWRIGHT` may point to an existing Playwright
package directory outside this workspace; the default is the `playwright`
module resolved from the desktop test directory. No extra runtime dependency is
needed for the harness.

```powershell
pnpm install --frozen-lockfile
pnpm -r --filter ./packages/* build
pnpm --filter @pi-desktop/desktop run bundle:runtime
pnpm --filter @pi-desktop/desktop build
cargo build -p host-core --locked
$env:PI_TEST_PLAYWRIGHT = 'C:/path/to/node_modules/playwright'
```

Replace example paths with installed locations. Both suites use the compiled
Electron output and `target/debug/pi-desktop-host-core.exe`; rebuild them after
desktop, shared, runtime or Rust changes. The browser suite also accepts
`PI_DESKTOP_HOST_BIN` when explicitly testing another compatible host binary.

## Electron and mobile browser flow

`attachment-cache.mjs` is the focused controlled attachment-cache path. It
opens a desktop-owned image from the phone, verifies the relay download and
IndexedDB write, reloads the phone with the MC boundary offline, previews the
cached image without another relay read, then revokes the grant and checks that
the image bytes and shared session are gone. It uses isolated profiles and
makes no model requests.

```powershell
node apps/desktop/test/e2e/mobile/attachment-cache.mjs
```

`sync-preview.mjs` is the focused account/sync regression flow: empty HTTP 429
responses with Retry-After, server-issued installation identities, pairing,
restart without registration, token refresh preserving device secrets, history,
and an interactive temporary-session HTML link in the native browser view.
It makes no model requests and records both renderer and native-window captures.
It also verifies explicit desktop logout clears the local installation identity
and share scopes.

```powershell
node apps/desktop/test/e2e/mobile/sync-preview.mjs
```

```powershell
$env:PI_TEST_OUTPUT = Join-Path $PWD ('.artifacts/mobile-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node apps/desktop/test/e2e/mobile/acceptance.mjs
```

The harness starts its own fixture and mobile Vite server, launches an Electron
window, and opens mobile UI in headless Chromium at phone-sized viewports. It
injects an in-memory credential store through the acceptance-only browser hook;
this does not test Android secure storage. Desktop browser authorization is
completed against the local fixture by capturing `shell.openExternal`; it does
not test the operating system's default-browser association.

Scenarios exercise visible desktop pairing controls, wrong-account rejection,
invalid/expired codes, concurrent token renewal, explicit session scope, bounded
history with paging during live updates, phone continuation, streaming, queued
messages, immediate stop, questions, tool and plan approvals, attachments, reconnect and lost
send acknowledgements, desktop image settings, invalid image request drafts,
generated images, restart, revocation, project shares including future sessions,
and narrow English/Chinese light/dark screens. Read the current assertions in
`acceptance.mjs` and the generated report for the exact coverage of a run.

## Native Android APK flow

Use JDK 21, Android SDK 36 with platform-tools, and a running dedicated emulator
or test device with ADB access. The script targets `emulator-5554` by default;
`PI_ANDROID_SERIAL` selects another connected device. Native picker assertions
use English Android system labels, so use an English system image.

```powershell
$env:JAVA_HOME = 'C:/path/to/jdk-21'
$env:ANDROID_HOME = 'C:/path/to/Android/Sdk'
$env:PATH = "$env:JAVA_HOME/bin;$env:ANDROID_HOME/platform-tools;$env:PATH"
$env:PI_TEST_PLAYWRIGHT = 'C:/path/to/node_modules/playwright'
$env:PI_ANDROID_SERIAL = 'emulator-5554'
adb devices
$env:PI_TEST_OUTPUT = Join-Path $PWD ('.artifacts/android-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node apps/desktop/test/e2e/mobile/android.mjs
```

The native suite starts its own fixture, builds the mobile web app in acceptance
mode, runs Capacitor sync and `gradlew.bat assembleDebug`, installs the APK with
`adb install -r`, and uses `adb reverse` for the fixture's local port. It then
controls the real Capacitor WebView through Playwright and native Android
controls through ADB. Electron still needs the prebuilt desktop/Rust outputs
from the prerequisite step.

The installed application ID is `xyz.mirrorcoding.pi.mobile`. Use a dedicated
test installation: this script signs out any previous test login through the
app, restarts the app, and puts a fixture image in the device's Downloads folder.
It does not clear Android application data or bypass secure storage.

Native scenarios cover password login, real secure credential persistence,
empty 429/Retry-After recovery and MC-declared RSA-OAEP-256 password encryption,
pairing, Android Back, continuation and streamed replies, soft-keyboard layout,
background/foreground recovery with a draft, the system file picker, reference
image upload, image generation/preview, the Android save/share sheet, reuse of a
generated image, and process restart with restored history and pairing.

The APK at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` after
this run is an acceptance build tied to the temporary fixture. Rebuild normal
mobile assets and sync before producing a distributable APK:

```powershell
pnpm --filter @pi-desktop/mobile build
pnpm --filter @pi-desktop/mobile android:sync
Push-Location apps/mobile/android
./gradlew.bat assembleDebug --console=plain
Pop-Location
```

Normal builds use the production MC origin. Their login/pairing requires the
MC-team implementation of the handoff contract.

After the native acceptance suite, `production-apk.mjs` signs out that controlled
test account through the app, builds official-origin assets, synchronizes them,
builds and copies a debug-signed preview APK, then installs and opens its login
screen without submitting to MC. It uses the same Android/Java/Playwright
environment as `android.mjs`. `--verify-installed` checks an already packaged
preview without rebuilding. `PI_TEST_OUTPUT` selects the delivery directory.

## Standalone fixture and artifacts

For manual client development, start only the fixture:

```powershell
$env:PI_MOBILE_FIXTURE_PORT = '4319'
node apps/desktop/test/e2e/mobile/fixture.mjs
```

Without `PI_MOBILE_FIXTURE_PORT`, it chooses an available loopback port and
prints the URL. Fixture-only credentials are `mobileqa` / `mobile-pass`; `other`
with the same password represents another account. The optional controlled
verification code is `123456`. The fixture is process-local and resets its
device/pairing metadata on restart. Stop it with Ctrl+C. Automated suites start
their own fixtures and do not require this standalone process.

Each suite writes `report.json`, screenshots and an isolated desktop profile to
`PI_TEST_OUTPUT`, or a timestamped directory under `.artifacts` by default.
The browser report records the candidate revision, remote main revision, and
workspace status at the beginning and end of the run. Review dirty files and
the compiled desktop source revision when associating a run with a commit.
The native suite additionally writes web/sync/Gradle build logs and failure
Logcat output. Failed assertions set a nonzero process exit code. Check report
errors and cleanup errors as well as the listed passed assertions; screenshots
support visual review and do not alone prove the workflow succeeded.

These artifacts verify PI client behavior against a controlled external
boundary. They do not establish that MirrorCoding has implemented or deployed
the service. Joint MC acceptance must run separately against the MC team's
local service using the [handoff contract](../../../../../docs/mirrorcoding-mobile-sync-requirements.md).
Record those results separately from fixture runs and production deployment.

## Upstream/mobile/preview candidate acceptance (2026-10-06)

- Executable candidate: `43ab7ad2f1934cf5c049bdebddec8db68798ce8b`.
- Fork base: `920b12b8e053165d343a421b3cb8ee93c50a436a` (`origin/main`).
- Integrated upstream: `924a03a7b04a51e3213142d147ed4d1e67a0ed0e`, version 0.16.1.
- Environment: Windows, Node 24.19, Rust 1.90, JDK 21, existing PiMobileQA
  `emulator-5554`. Electron/Rust profiles and MC/upstream fixtures were isolated.

| Check actually run | Result |
| --- | --- |
| `sync-preview.mjs` | 16 passed; `.artifacts/sync-preview-1791259138033/report.json` |
| `android.mjs` | 27 passed; `.artifacts/android-1791259174205/report.json` |
| `pnpm build:js` and desktop `bundle:runtime` | Passed; desktop, mobile and documentation built |
| Desktop typecheck and `pnpm lint` | Passed |
| Agent runtime tests | 1,354 passed |
| Shared tests | 1,192 passed (includes source and generated dist suites) |
| Mobile and i18n tests | 20 and 38 passed |
| Focused desktop account/browser/remote-bootstrap tests | 38 passed |
| `cargo +1.90.0 test -p host-core --locked` | 774 passed |
| Rust format and all-target Clippy | Passed |

Screenshots were inspected for the native HTML browser guest, Android login
rate-limit notice, pairing, and light/dark conversation layouts. The desktop
window capture (not renderer-only capture) confirms the native page is visible
and interactive. The native suite rejects plaintext when RSA login is enabled.

The broad desktop suite was also run, not silently omitted: 3,558 passed,
46 failed and 8 skipped. Two local-network failures (MCP OAuth and plugin egress)
passed focused reruns. One AR307-versus-upstream download expectation was corrected
and passed. The remaining 43 failures concern Windows-incompatible POSIX/macOS
shell/SSH fixtures, chmod/path-separator expectations, and the plugin filesystem
fixture's `INVALID_ARGUMENT` versus `NOT_FOUND` expectation. The complete desktop
suite is therefore **not reported green**; raw failures are retained in
`.artifacts/desktop-tests.jsonl`. No actual macOS/Linux build was performed.

After the native suite, the package helper was corrected to follow the visible
sign-out confirmation. It then built, installed and opened
`.artifacts/mobile-package-0.16.1/pi-mobile-0.16.1-preview.apk`: debug-signed,
official MC origin, no acceptance hooks. That probe stopped at login without
submitting credentials to production. The emulator retains this normal preview,
not an APK tied to the stopped fixture. The package report and login captures
are in the same directory. No paid model call, MC deployment, push or Release
was part of this acceptance.

## Native Messages response recovery

Run `node apps/desktop/test/e2e/mobile/response-recovery.mjs` after the builds
above. This uses a separate isolated profile and controlled native Messages
upstream. It checks original MC model/group routing, adaptive max effort,
thinking-only/truncated/interrupted/empty outcomes, explicit Continue across
desktop restart, draft preservation, cancellation and bilingual light/dark
screenshots on desktop and phone-sized Chromium. Artifacts and the candidate
revision are recorded under `.artifacts/response-recovery-*`. This is not
native Android or production MC/Kiro acceptance.

## MC Fast acceptance coverage (2026-09-30)

The browser flow changes Fast from both devices, preserves the active launch
while applying the next queued selection, checks actual Chat request tiers,
creates an explicitly authorized second-model child with Fast and tool
continuation, verifies parent/child independence, and restores Fast after a
desktop restart. Requested-tier labels are checked on desktop and mobile.

The native Android flow checks the model-sheet Fast control, persistence and
the actual outgoing tier before continuing the native attachment/image and
restart scenarios. Await closing dialogs before typing: their underlying
fields remain inert during the exit animation. Tap inputs when testing the
Android keyboard; programmatic focus alone does not guarantee the IME opens.

Use the existing PiMobileQA device with a normal keyboard, not the keyboard
handwriting tutorial. The acceptance run may use local dependency junctions;
keep generated Capacitor dependency paths out of source commits. These checks
prove controlled client behavior, not production MC deployment or speed.


## Account sharing and durable offline history (2026-10-06)

Run `node apps/desktop/test/e2e/mobile/account-sync.mjs` after shared, host-runtime,
RACP, i18n, sidecar and desktop builds. The browser flow uses three isolated real
Electron/Rust instances and the controlled MC relay. It checks initial discovery,
610 loaded messages, concurrent expansion/paging while changes are delayed,
offline restart, only three changed rows after a desktop restart, automatic third
computer discovery and account-grant revocation with a remaining session grant.

For PiMobileQA, run the same script with `PI_TEST_ANDROID=1`, `ANDROID_HOME`,
`JAVA_HOME` (JDK 21) and `PI_TEST_PLAYWRIGHT`. It builds/installs a separate
`xyz.mirrorcoding.pi.mobile.accountqa` APK and exercises the native secure store,
Capacitor WebView, process force-stop/relaunch and dark-English/light-Chinese
screenshots. It never replaces the normal mobile application. Optional
`PI_TEST_DESKTOP_ROOT` points at an already built candidate; both revisions are
recorded in the report. `PI_ANDROID_SKIP_BUILD=1` reuses an unchanged QA APK.

Controlled APK updater acceptance is separate:
`node apps/mobile/test/android-update-e2e.mjs`, using the two QA packages and
local manifest instructions in the mobile README. It verifies DownloadManager,
cancel/retry, process restart, unknown-source permission and system installation.
The first updater build needs manual installation; these tests do not publish a
GitHub release or prove production MC account-grant support.
