# PI Mobile

Android companion for an online PI Desktop. The desktop owns history, execution,
approvals, model settings and image generation. MirrorCoding authenticates and
pairs devices and relays their connections; it does not execute agents.

## Development

Requires the repository's Node version, pnpm, JDK 21 and Android SDK 36.

```sh
pnpm install
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

History and attachment bytes are fetched on demand from the online desktop.
Drafts survive navigation and network disconnects within the running app.
Stopping sync does not stop desktop tasks. The app supports English and Chinese,
light/dark/system appearance, system file picking and native save/share.
Normal app restarts preserve the signed-in device and its pairings. Explicit
sign-out clears the local account/device credentials; the next password login
registers a new device and requires pairing again. Existing grants can be
revoked from the desktop's mobile-sync manager.

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
