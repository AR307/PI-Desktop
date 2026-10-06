# Mobile account sync preview: delivery and validation

Date: 2026-10-06. Local preview only; nothing was pushed or published.

## Candidate and ownership

- Branch: `codex/mobile-account-sync`.
- Task baseline: `a3a961290`; includes upstream 0.16.1 through `924a03a7b`.
- Fork base: `920b12b8e053165d343a421b3cb8ee93c50a436a`. A final fetch confirmed
  that this remained `origin/main` and an ancestor of the candidate.
- Desktop: 0.16.1. Android: 0.16.2, versionCode 5, application ID
  `xyz.mirrorcoding.pi.mobile`, minimum SDK 24, target SDK 36.
- Desktop executable behavior was complete at `ddd494df6`. The final mobile
  cache correction is `f8a9a5a81`; manifest generation is `e4b2d966a`.
  Subsequent changes are test harnesses and documentation.

The source remains in the PI-Desktop repository. Mobile release assets belong
to `AR307/Mirrorcoding-APP`, independently of desktop release assets.

## Delivered files

Paths are relative to this worktree:

| File | Purpose |
| --- | --- |
| `.artifacts/delivery/desktop-installed/PI-Desktop-Setup-0.16.1-mobile-sync-preview.exe` | Windows x64 installer |
| `.artifacts/delivery/desktop-portable/PI-Desktop-Portable-0.16.1-mobile-sync-preview.exe` | Windows x64 Portable |
| `.artifacts/delivery/pi-mobile-v0.16.2.apk` | Android release-variant preview, signed with the existing application identity |
| `.artifacts/delivery/mobile-update.json` | Future mobile release asset; its URL is not published by this task |

The APK contains the normal MC origin and no acceptance credential hook or
localhost fixture origin. It is not debuggable. Its signing certificate matches
the installed previous application. Windows previews are not Authenticode signed.

## Implemented user paths

1. Android Account shows the installed version, check action, release notes,
   download progress, cancellation/retry and explicit system installation.
   The same screen is accessible before sign-in. Automatic checks run daily.
2. Desktop Account → Mobile sync opts this computer into account sharing.
   Account pairing discovers all same-account computers which explicitly opt in.
   Existing project/session grants stay narrow; each phone pairs separately.
3. Directories, loaded history, expanded content and downloaded attachments are
   stored per account/computer/session. Reopening reads local pages first.
4. Rust persists change revisions independently of process RACP cursors.
   Reconnection after a host restart applies updates and deletion markers rather
   than downloading another full snapshot. Only the open session streams bodies.
5. Revocation recomputes remaining scopes, including on offline restoration.
   Signing out clears the account's local cache. Offline reading remains available
   until a disconnected device learns that its authorization was revoked.

## Executed acceptance

| Environment | Result and evidence |
| --- | --- |
| Real Electron/Rust + mobile Chromium | 32 checks passed; zero renderer/cleanup errors. `.artifacts/mobile-account-1791294446625/report.json`. The uncommitted controller change recorded by this run was subsequently committed as `ddd494df6`. |
| PiMobileQA Capacitor WebView + real Electron/Rust | 36 checks passed; zero errors. `../mobile-sync-acceptance/.artifacts/mobile-account-1791295655816/report.json`. Test candidate `795afc875`, desktop candidate `e4b2d966a`, mobile product includes `f8a9a5a81`. The script is integrated locally as `5088896a9`. |
| Real attachment relay + offline mobile browser | 4 checks passed; zero errors. `.artifacts/mobile-attachment-cache-1791296237494/report.json`, clean candidate `53bf9a962`. |
| Android native updater | Four native user-flow groups passed on isolated `xyz.mirrorcoding.pi.mobile.updateqa2`: signed-out check; download/cancel; retry and force-stop recovery; system covering install from code 5 to 6. Screenshots are in `../mobile-update/.artifacts/mobile-update-qa/`. |
| Android upgrade data retention | The same native installer flow passed on isolated `xyz.mirrorcoding.pi.mobile.updateqa3`, code 7 to 8. After cancelling installation and after successful covering installation, real secure-storage credentials, cached pairing, directory and history remained readable. Test commit `47460701c`, locally integrated as `2f681513d`; six screenshot stages under `../mobile-update/.artifacts/mobile-update-retention-qa/`. |
| Windows packaged applications | NSIS payload passed the real preload/IPC/Rust boot probe. Portable self-extraction and its real window passed version/protocol queries; `.artifacts/portable-visible-1791295051315/report.json` and `portable.png`. The installer wizard itself was not executed. |

The account flows verify three computers, same-path isolation, empty projects,
ungrouped sessions, discovery without transcript transfer, paging during a delayed
change response, 610 loaded messages after force-stop/offline reopen, retained
90 KB expanded content, and exactly three changed rows after a desktop restart.
The third computer appears without another pairing. Opt-out, account revocation
with a surviving single-session grant, and interrupted cache pruning remain
scoped correctly after offline reopen. No model calls occur in these scenarios.

The attachment flow uses the real desktop file/relay boundary, downloads an image
once, reopens its preview offline without another read, then revokes the grant
and verifies removal of cached image bytes and directory visibility.

The final release APK was built from mobile-update candidate `78d0119b9`, which
contains the same final mobile runtime as the main task worktree. The later
acceptance-only storage hook is eliminated from production builds; a fresh
production build and the delivered APK were checked for its absence. Native
acceptance used isolated application IDs; the normal installed app was not
overwritten by those tests. Reviewed screenshots include dark English, light
Chinese, multiple computers, offline history, image preview and Android installer.

## Automated checks and builds

- Rust host-core: 780 tests passed; format, Clippy and release build passed.
- Mobile: 22 tests passed. i18n: 38 tests passed.
- Host-runtime: 120 passed, three declared skips, after sidecar rebuilding.
- Desktop mobile-peer: 8 passed, including a roughly 1.3 MiB tool message.
- Shared sync contracts: 34 passed; scope/IPC: 10 passed; AgentHost: 60 passed.
- Affected shared/i18n/runtime/host-runtime/RACP/mobile builds and desktop/mobile
  typechecks passed. Desktop production bundle, runtime sidecar and style-token
  checks passed. No new run of the unrelated broad cross-platform desktop suite
  is claimed; its inherited Windows failures are documented in the prior preview.
- Android production Vite build, Capacitor sync, Gradle release assembly, package
  metadata and signing verification passed. Native SDK installation was separately
  exercised above. These checks do not prove production MC behavior.

This Windows environment uses direct repository Node tool entry points because
the available pnpm installation rejects the dependency junction. The equivalent
individual builds were executed; a new successful `pnpm build:js` run is not claimed.

## Build and retest entry points

Use the repository Node runtime, JDK 21, SDK 36 and existing PiMobileQA. The
account script supports `PI_TEST_ANDROID=1`, `PI_TEST_DESKTOP_ROOT` and
`PI_TEST_PLAYWRIGHT`; detailed setup is in the mobile E2E README. Rebuild the
runtime sidecar before launching Electron.

```sh
node apps/desktop/test/e2e/mobile/account-sync.mjs
node apps/desktop/test/e2e/mobile/attachment-cache.mjs
node apps/mobile/test/android-update-e2e.mjs
```

For the normal APK, compile shared dependencies and typecheck mobile, then run
`vite build` and `cap sync android` from `apps/mobile`. Run
`gradlew.bat assembleRelease --offline -Pkotlin.incremental=false` from
`apps/mobile/android`. Align and sign the unsigned release output using the
existing locally managed signing identity. Keep signing credentials outside
source and command logs. Never publish an APK signed with a different identity.

The retention scenario seeds only controlled fixture credentials through the
existing native store and seeds caches through their public services. It verifies
them after real system installer operations. This tests application storage
continuity; it does not claim a live MC session was reauthenticated during upgrade.

Generate its corresponding release manifest from repository metadata:

```sh
node apps/mobile/scripts/generate-mobile-update.mjs .artifacts/delivery/mobile-update.json docs/releases/mobile-0.16.2.md
```

The local desktop packaging entry point is `.artifacts/build-desktop-preview.cjs`;
it uses existing electron-builder NSIS/Portable targets with `publish: 'never'`.

## Acceptance boundaries and compatibility

- MC must implement and deploy
  [the account-sync increment](mirrorcoding-mobile-account-sync-requirements.md)
  before production account-wide pairing and discovery can work. No server code,
  production credentials or paid upstreams were used here.
- The first updater APK is installed manually. Future official releases must
  upload both the APK and `mobile-update.json`; no current GitHub update asset was
  created. A failed update check does not block login or conversation use.
- Upgrade desktop and mobile together for the new durable history contract. Rust
  schema 22 adds the revision index while retaining complete desktop history.
- IndexedDB v2 replaces the old unpartitioned 500-row tail cache. That obsolete
  cache is not imported; previously loaded content from that format is fetched
  once again from desktop. New account-scoped loaded history then persists without
  the 500-row eviction. Desktop histories and attachments remain authoritative.
- Full histories are loaded on demand, not downloaded for every discovered
  conversation. Unloaded messages and attachments cannot be read offline.
- macOS packages, production MC joint acceptance and a real published GitHub
  update were outside this local-preview task.
