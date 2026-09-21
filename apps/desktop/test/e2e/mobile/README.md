# Mobile companion controlled acceptance

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
pnpm --filter @pi-desktop/desktop build
cargo build -p host-core --locked
$env:PI_TEST_PLAYWRIGHT = 'C:/path/to/node_modules/playwright'
```

Replace example paths with installed locations. Both suites use the compiled
Electron output and `target/debug/pi-desktop-host-core.exe`; rebuild them after
desktop, shared, runtime or Rust changes. The browser suite also accepts
`PI_DESKTOP_HOST_BIN` when explicitly testing another compatible host binary.

## Electron and mobile browser flow

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
