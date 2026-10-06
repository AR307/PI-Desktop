# MC account-sync client alignment

Date: 2026-10-07

## Scope and baseline

This aligns PI with the MC team's 2026-10-06 account-sync handoff. It changes
desktop/mobile client behavior and the controlled MC fixture only. No production
MC request, provider request, account modification, push or deployment is part of
this acceptance.

- Branch: `codex/mobile-account-sync-alignment`.
- Feature baseline: `c1198f5d56471041205fb4ec2a527ccdcc18adfd`, including the
  account-sync and session-error fixes.
- Remote main: `920b12b8e053165d343a421b3cb8ee93c50a436a`, an ancestor of the
  candidate. No main integration or history rewrite was needed.

## Reproduction and correction

The original built desktop failed `sharing publication retries without user
refresh`: local opt-out was saved, MC returned 503, and the server sharing flag
remained enabled after service recovery. Evidence is in
`.artifacts/baseline-service/report.json`. Entering through public IPC avoids a
renderer refresh accidentally masking the missing service retry.

The service now uses its existing retry timer for transient failures, respects
Retry-After, and exposes its persisted pending flag to the renderer. Pairing is
disabled while an opt-in awaits acknowledgement. Offline devices retain cached
directories/history without requesting new tickets. The mobile relay hands MC
offline/revocation/auth closures to directory/account ownership; permission
narrowing refreshes grants/devices before reconnecting with remaining scopes.

The MC fixture now returns the documented sharing response and error codes,
including 409 DESKTOP_OFFLINE. It tracks effective grants and closes connections
when any previously effective grant disappears, matching MC permission narrowing.
The phone identity in peer.open is deviceId; grants still use mobileDeviceId.

## Validation

- Desktop/mobile TypeScript checks passed; shared/i18n builds passed. All nine
  shared package builds and the runtime sidecar were rebuilt in the task worktree.
- Mobile: 22 tests passed. i18n: 38 tests passed. Desktop mobile IPC, device
  registration, scope and peer contracts: 13 tests passed.
- Electron Main/Preload/Renderer production build passed. Android web build,
  Capacitor sync and isolated debug APK assembly passed.
- Actual Electron plus a phone-sized browser passed 46 checks in
  `.artifacts/controlled-alignment-final/report.json`: publication retry,
  used/expired pairing errors, offline computer reopen, automatic wake recovery,
  account-to-session revocation/reconnection, 610 cached messages and durable
  edits/deletions across desktop restart. No model requests were made.
- Inspected screenshots include English offline history and the Chinese expired
  pairing sheet with the original code retained beside its explanation.

The first full-history attempt used an older host binary and correctly failed
with snapshot_sync_revision_missing; it is not claimed as a product regression.
The successful run uses the rebuilt host from the session-tool-errors worktree,
whose host-core source matches this candidate. Node/toolchain/dependencies were
reused, with task-local workspace package links; no dependency installation was
needed. Individual repository tool entry points were used instead of claiming a
new successful pnpm aggregate run.

Native Android acceptance results are recorded after running the same flow on
the existing PiMobileQA, using its isolated account QA app. Production MC joint
acceptance remains separate from this controlled client validation. No database
schema or native Android implementation changed.
