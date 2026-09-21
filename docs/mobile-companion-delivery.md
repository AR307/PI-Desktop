# PI Mobile local delivery

The PI desktop and Android companion baseline is implemented on
`codex/mobile-companion`; the current interface and session controls are on
`codex/mobile-ui-controls`. MC server implementation and deployment remain with
the MirrorCoding team. Send them
[`mirrorcoding-mobile-sync-requirements.md`](mirrorcoding-mobile-sync-requirements.md).

## Using the feature after MC integration

1. Run this desktop branch and authorize the MC account in Settings → Account.
2. Right-click a project or session and choose Sync to mobile.
3. Install the current APK from
   `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, sign in with
   the same MC account and enter the eight-digit code shown on desktop.
4. Open the shared work to read history/live output, continue messages, send
   attachments, stop work, answer questions or resolve approvals. Image mode uses
   the desktop's model/group/options and accepts supported reference images.
5. Manage or revoke a share in desktop Settings → Account → Mobile sync.

Desktop must remain running and online. Phone shutdown does not stop its tasks.
Normal phone/desktop restarts retain pairing and durable history. Explicit phone
logout clears its local device credentials and requires pairing on the next
password login. Full desktop restart keeps PI's existing behavior of marking
pending plans interrupted; phone reconnect alone preserves pending approval.

The preview APK is debug-signed for local installation, with the fixed official
origin `https://console.mirrorcoding.xyz` and no acceptance hooks. It does not
contain fixture credentials. MC login and pairing cannot work until the new
server contract is available. This delivery is not a Play Store release.

## Verified candidate and evidence

- Executable source: `d2e5917ef4ac8558e40196e9f4446c1f1278249c`.
- Base `origin/main`: `996922fa729870e88ed9e439aa6959e388c12f91`, refreshed again
  before delivery. Subsequent changes only record tests/docs and test naming.
- Actual isolated Electron + touch browser: **41 checks passed**, no renderer or
  cleanup errors. Includes scope isolation, invalid/expired codes, concurrent
  token refresh, 60-message pagination alongside live events, queued continuation,
  stop, questions, tool/plan approval, lost acknowledgements, photo upload,
  unsupported image reference preservation, image edits, reconnect, both process
  restarts, revocation and current/future project sessions.
- Actual Android 15 emulator / WebView 124: **19 checks passed**, no WebView
  exceptions. Includes native secure storage, pairing, message continuation,
  keyboard layout, background/foreground, system file picking, image preview,
  system save/share, reference reuse and process-restart credential/history
  recovery. Native and browser EN/ZH light/dark screenshots were reviewed,
  including the 320px browser view and native system bars.
- The official-origin preview APK was built, installed and opened at login
  without submitting a production login. APK size is approximately 5.5 MiB.

Evidence is outside Git at `D:/piformc-artifacts/mobile-companion/`:

- `browser-acceptance-reviewed/report.json` and screenshots.
- `android-acceptance/report.json` and native screenshots/build logs.
- `delivery/pi-mobile-0.15.1-preview.apk`, `package-report.json` and login image.

Relevant checks passed: all eight workspace package builds, desktop production
build and typecheck, mobile typecheck/build, repository lint, scoped mobile lint,
876 shared tests, 21 RACP tests, 32 focused AgentHost/approval tests, four host-port
tests, five mobile tests, 25 i18n tests, 10 Rust queue tests and Rust format.
Clippy completed with one pre-existing unrelated `user_skills.rs` warning.

## Interface and session-control update

The `codex/mobile-ui-controls` task adds the compact conversation layout, shared
animated surfaces, improved keyboard/back behavior, and phone-side selection of
Agent, Plan, Goal or Image. It also adds searchable desktop model catalogs,
MirrorCoding model/group pricing, reasoning levels and declared image options.
These settings apply only to the current shared session. Model/group/reasoning
changes made during a running task are saved for the next turn; mode changes wait
until the task and approvals are idle.

The final controlled Electron/mobile-browser run passed all **59 checks** with no
renderer or cleanup errors. It includes the original sync flows plus current vs
next-turn configuration, all four modes, image parameters, translated controls,
draft preservation and visual/overflow checks at 390px and 320px. Screenshots and
the report are under the ignored local artifact directory
`.artifacts/mobile-ui-controls-candidate-480a9c4e/`. The report binds the clean
executable candidate `480a9c4eb770b41159cf94ce74bea9a068794bb6` to base
`996922fa729870e88ed9e439aa6959e388c12f91`.

Capacitor sync and Gradle `assembleDebug` passed. The current debug APK is
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (approximately
5.35 MiB). A fresh native interaction run for this revision could not start: the
local Android emulator reported `WHPX: too many emulator instances are running`
for both the existing AVD and a new isolated `PiMobileUIQA` AVD. No AVD or lock
file was removed. The 19-check native result above applies to the companion
baseline; it is not presented as native execution evidence for this UI revision.

`apps/desktop/test/e2e/mobile/README.md` describes how
to reproduce these real user flows. Fixtures replace only external MC/upstream
boundaries; the desktop, Rust host, Node agent and Android native plugins run.

## Remaining external acceptance

MC-team local service integration and official deployment were not tested.
No production login or paid model calls were submitted. Emulator acceptance
does not cover every manufacturer, Android release or physical network switch;
the minimum SDK is 24 and target SDK is 36. Store signing and distribution are
separate from this installable preview. No branch was pushed or merged.
