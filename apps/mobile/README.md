# PI Mobile

Android companion for an online PI Desktop. The desktop owns history, execution,
approvals, model settings and image generation. MirrorCoding authenticates and
pairs devices and relays their connections; it does not execute agents.

## Development

Requires the repository's Node version, pnpm, JDK 21 and Android SDK 36.

```sh
pnpm install
pnpm -r --filter ./packages/* build
pnpm --filter @pi-desktop/mobile dev
pnpm --filter @pi-desktop/mobile build
pnpm --filter @pi-desktop/mobile android:sync
cd apps/mobile/android
./gradlew assembleDebug
```

On Windows use `gradlew.bat`. Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to
the installed Android SDK. The APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. Production packages use
`https://console.mirrorcoding.xyz`; credentials are held by the native secure
storage plugin. Android backup is disabled. Do not place signing keys in Git.

The production service must implement the contract in
[`mirrorcoding-mobile-sync-requirements.md`](../../docs/mirrorcoding-mobile-sync-requirements.md).
Until that service is deployed the production APK cannot complete login and
pairing against MirrorCoding. No desktop provider tokens enter the phone.

## Architecture

- `src/services/account.ts`: native account login/challenge, token refresh,
  device registry, pairing and grants.
- `src/services/relay.ts`: browser RACP client and short-lived relay tickets.
- `src/services/attachments.ts`: native picker, chunk transfers and Android share.
- `src/state/controller.ts`: navigation workflows, scoped sessions, actions and
  reconnect snapshots. Uncertain mutations are not automatically replayed.
- `src/components`: mobile views, Markdown, task details, approvals and questions.
- `src/styles.css`: responsive layout using the desktop's canonical color tokens.
- `android`: Capacitor application, SDK 24 minimum / SDK 36 target.

Computer/project/session indexes and loaded history render from account-scoped
IndexedDB before networking. Older pages and attachment bytes are fetched only
when absent locally. Loaded messages have no 500-row cap; expanded content and
downloaded attachments remain readable offline. A Rust-owned revision reconciles
updates and deletions across desktop restarts without fetching the full history.
Only the open conversation subscribes to live content; other computers keep
light directory subscriptions. Offline operation is reading only.
Drafts survive navigation and network disconnects within the running app.
Stopping sync does not stop desktop tasks. The app supports English and Chinese,
light/dark/system appearance, system file picking and native save/share.
Normal app restarts preserve the signed-in device and its pairings. Explicit
sign-out clears the local account/device credentials; the next password login
registers a new device and requires pairing again. Existing grants can be
revoked from the desktop's mobile-sync manager.

Account pairing discovers all computers that explicitly enable account sharing;
existing project/session grants are not widened. The MC increment is specified in
[`mirrorcoding-mobile-account-sync-requirements.md`](../../docs/mirrorcoding-mobile-account-sync-requirements.md).
Confirmed revocation clears only caches no longer covered by another grant.
Explicit sign-out clears the account cache; disconnected phones learn revocation
on their next connection.

Conversation controls update only the current shared session. The phone can
choose Agent, Plan, Goal or Image and select any currently usable desktop chat
or image model. MirrorCoding selection is model then group; reasoning and image
parameters follow capabilities returned by desktop. Chat and image choices are
remembered separately. A model/reasoning change saved during a running chat
applies to the next turn; mode changes wait until work and approvals are idle.

## In-app updates

Android checks `AR307/Mirrorcoding-APP`'s `mobile-update.json` once per day on
startup or foreground, or immediately from Account. A newer compatible APK can
be downloaded with Android DownloadManager, cancelled and retried, then handed
to the system installer through the app's FileProvider. The first APK that
contains this updater must still be installed manually; later releases can be
installed from Account. Generate the release manifest with
`pnpm --filter @pi-desktop/mobile update:manifest <output-file> [notes-file]`.
Upload the resulting `mobile-update.json` and its named APK together to a formal
release in `AR307/Mirrorcoding-APP`. The Android package version comes from this
package's version; increment `versionCode` in `android/app/build.gradle` for every
published APK and use the existing signing identity for covering upgrades.
The app never installs silently and GitHub or download failures do not block
normal account and transcript use.

For controlled native acceptance, build two debug APKs with the same isolated
`piMobileAcceptanceApplicationId` and version codes 6 and 5, using Gradle's
`-PpiMobileAcceptanceApplicationId=...` and
`-PpiMobileAcceptanceVersionCode=...` properties. Build code 6 first and place
it at `.artifacts/mobile-update-qa/update.apk`, then install code 5. Build the
web assets with Vite `--mode acceptance` and
`VITE_MOBILE_UPDATE_MANIFEST_URL=http://127.0.0.1:38479/mobile-update.json`.
After `cap sync android`, run `node apps/mobile/test/android-update-e2e.mjs`
with `ANDROID_HOME`, `PI_ANDROID_SERIAL` and `PI_ANDROID_UPDATE_APP_ID` set.
The harness serves the manifest/APK only on localhost, uses `adb reverse`, and
captures screenshots under `.artifacts/mobile-update-qa`. Use a fresh isolated
application ID for each full run; no production account or GitHub call is made.
For another version pair, set `PI_ANDROID_UPDATE_VERSION_CODE` to the target code
and install the preceding code first. `PI_ANDROID_UPDATE_OUTPUT` chooses a separate
artifact directory containing that run's `update.apk`. The acceptance-only storage
fixture uses the real native secure store and cache services to verify credentials,
pairing, directory and history survive installer cancellation and covering upgrade.

## Controlled acceptance environment

Use `vite --mode acceptance` with `VITE_MC_ORIGIN` set to the controlled local MC
fixture. An acceptance web harness injects
`window.__PI_MOBILE_TEST__.credentialStore` with async `read`, `write`, `clear`
methods before loading the app. This hook is inactive in production builds.
The native acceptance APK still uses the real Android secure storage plugin.
Debug Android builds permit HTTP only for localhost and the emulator host alias;
release builds require HTTPS. Never use browser Web Storage for account tokens.

The root acceptance harness exercises real UI flows against the desktop and a
controlled relay. `pnpm --filter @pi-desktop/mobile test` additionally checks
account/refresh behavior and transcript handling at their public boundaries.
Regenerate launcher/splash assets from the PI desktop icon with
`python apps/mobile/scripts/generate-icons.py` (Pillow required).
