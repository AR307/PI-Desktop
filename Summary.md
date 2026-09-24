# PI-Desktop MirrorCoding Edition

## Project overview

This branch starts from upstream PI-Desktop `920b12b8e` (0.15.6, 2026-09-24)
and adds MirrorCoding support without replacing upstream agent, image, plan, or
remote-host implementations. The desktop application remains an Electron
renderer plus Electron main process, Rust `host-core` persistence/runtime, and
Node agent sidecar. The Android companion will be added as a separate
Capacitor application after the desktop relay contracts are in place.

## Architecture map

- `apps/desktop/src`: React renderer, chat composer, model/mode controls, plans,
  images, settings, and work panels.
- `apps/desktop/electron/main`: Electron orchestration, IPC registration,
  provider/runtime bridges, image service, and remote-host lifecycle.
- `crates/host-core`: authoritative persistence, provider records, sessions,
  plans, and RPC contracts.
- `packages/agent-runtime`: Node sidecar agent execution, tools, image
  generation, and provider adapters.
- `packages/shared`: cross-process protocol and typed data contracts.
- `apps/mobile` (planned): Capacitor Android shell for scoped MirrorCoding
  session sync and continuation.

## Current baseline

- Source: `origin/main` and `upstream/main` at `920b12b8e`.
- Branch: `codex/mirrorcoding-new-baseline`.
- Remotes: `origin` is `AR307/PI-Desktop`; `upstream` is
  `vastsa/PI-Desktop`; `legacy` is the old local repository used only for
  audited comparisons.
- Upstream already provides generic image generation, image attachments and
  persistence, Plan/Goal/AskTool workflows, reasoning-level controls, and the
  RACP remote-host foundation.

## Migration status

1. Audit complete. MirrorCoding account/provider, MirrorCoding image routing,
   mobile sync/Android, mobile configuration, and window layout fixes are not
   present in the new upstream baseline.
2. Account/provider migration is being rebuilt against current Electron,
   shared, and Rust contracts.
3. Image work will adapt the upstream ImageService instead of copying the old
   image feature tree.
4. Mobile sync will reuse current RACP/remote-host primitives and enforce a
   scoped project/session relay.
5. Window sizing, panel dragging, and Plan prompt-question behavior have been
   migrated with focused regression coverage.

See `docs/mirrorcoding-v2-migration-audit.md` for evidence, boundaries, and
the staged acceptance plan.

## Mobile sync contract

The mobile-sync contract adds restricted project/session sharing types and IPC
channel names. `MobileDeviceCredentials` encrypts the MC desktop device
identity with Electron `safeStorage` and writes it atomically. The optional
`MobileSyncService` IPC seam validates pairing, cancellation, refresh, and
grant-revocation inputs without changing the existing remote-host protocol.

The relay, scope enforcement, Android client, and MC service implementation
remain separate follow-up work.
