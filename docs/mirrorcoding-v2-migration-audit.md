# MirrorCoding v2 migration audit

## Scope

The v2 fork is based on upstream `920b12b8e` rather than the old local main
(`996922fa7`) or any old feature branch. The old fork was several hundred
upstream commits behind, so a whole-branch merge would reintroduce stale
contracts and overwrite newer upstream behavior.

## What upstream already provides

The new baseline includes these capabilities and they remain the source of
truth:

| Capability | Current upstream area | Migration decision |
| --- | --- | --- |
| Generic image generation, edits, batches, references, persistence | `apps/desktop/electron/main/services/image-generation-service.ts`, `packages/agent-runtime/src/image-generation`, `packages/shared/src/image-generation.ts` | Keep; add a MirrorCoding adapter and capability metadata only |
| Plan, Goal, AskTool, approval and pending questions | `packages/agent-runtime/src/runtime.ts`, `apps/desktop/src/components/AskToolCard.tsx`, `crates/host-core/src/plans` | Keep; port only the MirrorCoding-specific prompt/recovery rule if still needed |
| Reasoning levels and session thinking controls | `apps/desktop/src/features/chat`, `apps/desktop/src/lib/session-thinking.ts` | Keep; map MirrorCoding declared capabilities into the existing selection |
| RACP and remote-host lifecycle | `packages/racp`, `apps/desktop/electron/main/remote` | Reuse framing/lifecycle; add a separately scoped MC relay rather than exposing Host RPC |
| Provider catalog/model bindings | current provider catalog and Rust provider repositories | Extend with a managed MirrorCoding provider identity |

## Old fork capabilities requiring migration

### MirrorCoding account and providers

The old account work started at `4f22ee42a`, was refined by
`8819fdf22`, `938899cbf`, `f4ae47368`, `6bbd39ec2`, and `1cba68476`, and
contains:

- Electron OAuth/PKCE, safeStorage credentials, refresh/revoke lifecycle,
  catalog synchronization, group-bound provider records, and local relay.
- Rust provider metadata/repository/RPC support for managed group providers.
- Shared account, catalog, group, model, and IPC contracts.
- Account settings/welcome UI and the model -> group picker.

These modules must be rewritten against current IPC, catalog, provider, and
Pi SDK contracts. No old implementation is copied wholesale.

### MirrorCoding image adapter

The old image commits `900ef92fa`, `414b15bc9`, and `699f709ca` added
MirrorCoding image routes, reference-image handling, and agent/direct flows.
Only the route/auth/capability adapter is needed in v2. The upstream ImageService
owns task state, attachments, persistence, result cards, and the agent tool.

### Mobile companion and relay

The old mobile commits `c271ca664` through `23d870d72` added scoped device
pairing, MC relay, desktop synchronization, and the Capacitor Android app.
The v2 implementation will preserve the pairing scope and online-only relay
semantics but use the current RACP/remote-host framing and current shared
protocol version.

### Window and Plan behavior

`60bd65c23` fixed WorkPanel header dragging and browser-view resize capture.
The current upstream code still has the wrapper `no-drag` region and direct
browser bounds updates, so this needs a small manual port.

`d2e7c0daa` added a MirrorCoding-oriented Plan prompt rule. The current
AskTool/Plan pipeline already supports questions and approvals; only the
minimal missing rule should be carried forward after verification.

## Explicit non-goals

- Do not replace the upstream generic image pipeline.
- Do not expose MirrorCoding access/refresh tokens to the renderer, sidecar, or
  Android app.
- Do not make MC a second unrestricted Host RPC endpoint.
- Do not copy old release binaries or old generated Android/Windows artifacts;
  rebuild them from the v2 tree.
- Do not silently alter existing non-MirrorCoding providers or sessions.

## Delivery stages

1. Account, managed provider identity, catalog, OAuth refresh/revoke, and relay
   contract tests.
2. MirrorCoding image route/capability adapter on the upstream ImageService.
3. Scoped desktop sync, device pairing, attachments, and Android shell.
4. Mobile model/mode/reasoning configuration and the remaining UI/window fixes.
5. Isolated Electron/Android/user-flow validation, then Windows installer,
   portable archive, and signed/debug APK builds as configured.
