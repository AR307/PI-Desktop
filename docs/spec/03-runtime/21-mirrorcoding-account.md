# 21. MirrorCoding account

## Account and onboarding

The first launch shows a centered, keyboard-modal MirrorCoding welcome dialog.
Sign in opens the system browser; Skip for now records completion. Successful
authorization also records completion. Later launches do not reopen the welcome.
Settings has a separate Account destination with sign-in, cancel, reauthorize,
change account, sign-out, refresh, account name, authorization expiry, and sync
status. The browser consent page owns its account-switch interaction.

The product origin is `https://console.mirrorcoding.xyz`. Users do not enter an
origin. An unpackaged app with an explicit isolated data directory may use a
loopback HTTP origin for local acceptance. This is not a packaged user setting.

## Ownership and contracts

Electron main owns OAuth, safeStorage encryption, catalog synchronization and
the streaming loopback relay. Rust owns provider persistence. The renderer only
receives public account state and catalog data. Access and refresh tokens never
enter renderer IPC, provider config, or sidecar launch configuration.

OAuth uses client `pi-desktop`, scope `pi_desktop`, PKCE S256, a random state and
a dynamic `127.0.0.1` callback port. Completion, cancellation, timeout and shutdown
close the callback listener. Authorization expires according to server lifetime;
refresh does not extend the original authorization deadline. Refresh is single
flight; concurrent callers await the same rotation. A 401 allows one refresh and
one replay of the request before output. Explicitly invalid grants require login.

`mirrorcoding.enc` contains only OS-encrypted active credentials, their public
catalog snapshot and pending revoke-only records. Missing secure storage is an
explicit error; there is no plaintext credential mode. Sign-out attempts server
revocation before clearing active credentials. Failed revocation leaves an
encrypted revoke-only record and the visible “signed out locally” notice.

IPC channels under `pi-desktop/mirrorcoding/` are `getState`, `login`,
`cancelLogin`, `refresh`, `logout`, `retryRevocation`, `completeWelcome` and the
`changed` event. Login/logout return `confirmationRequired` when tasks are active;
confirmed actions stop only MirrorCoding work. Shared and Rust protocol version
is 12. Host-only `providers.syncMirrorCoding` accepts `MirrorCodingProviderSync`.
No new SQLite tables or migrations are needed.

## Catalog, selection and reasoning

Each account/group pair has one managed provider row with public `mirrorCoding`
metadata and model bindings in existing `config_json`. Resync and reauthorization
reuse that row's ID. Account changes disable prior rows and preserve historical
sessions and explicit defaults. Generic provider CRUD cannot edit managed rows.
Subagent pins use the exact managed provider ID so account/group changes cannot
retarget a pin.

Catalog requests coalesce and run at login, startup, menu open, manual refresh and
group permission errors. Successful empty responses disable choices. Network
failure preserves the last successful projection and reports failed sync.

The model menu groups MirrorCoding separately, deduplicates exact catalog IDs,
then shows only groups supporting the chosen ID. Choosing a group commits the
whole provider/model pair. Closing or going back leaves the prior choice intact.
Show the account's group multiplier, or Dynamic billing for `auto`. Composer
shows model and group. Only when no default exists does an explicit first choice
set the default for new sessions. Existing defaults are preserved.

Protocol selection intersects the group's model capabilities, server endpoint
declarations and supported pi adapters. Native models.dev records are preferred
over reseller records. Prefer the known native protocol when available; otherwise
use Responses, Chat Completions, Anthropic Messages, Gemini in that order.
`openai-response-compact` is an additional capability, not a chat adapter.
Failures never change the selected protocol, model, group or account.

Models.dev supplies input capabilities, limits and reasoning levels. The selected
level is transmitted through pi: Responses `reasoning.effort`, Chat Completions
`reasoning_effort`, Anthropic `thinking`/budget and Gemini `thinkingConfig`.
Unsupported levels follow the existing clamp rule. Unknown IDs are callable
through their declared protocol without invented reasoning capabilities.

## Request flow and recovery

Sidecar requests use an ephemeral loopback credential tied to the selected
provider/group/session. Main adds Bearer and exactly-once percent-encoded
`X-Mirrorcoding-Group`. SDK API-key headers and query credentials are stripped.
The response preserves JSON/SSE, status, Retry-After and backpressure. Disconnect
or Stop cancels the upstream request. Proxy settings apply to upstream requests;
loopback requests bypass the proxy.

Normal chat, tool continuation, compaction, title generation, prompt enhancement
and inherited/pinned subagents use the same binding. The Google SDK uses a scoped
global-fetch bridge because its pi adapter rejects custom fetch options; this
retains per-request headers, retry evidence and proxy routing across sessions.

Temporary failures use the existing bounded retry policy before output, honoring
Retry-After. Once text, thinking or a tool call has appeared, MirrorCoding errors
do not replay automatically. Partial output remains visible with explicit
Continue. Group permission errors refresh the catalog and request reselection.

## Validation

`apps/desktop/test/e2e/mirrorcoding/acceptance.mjs` runs the actual Electron app,
Rust host, Node sidecar, real local MirrorCoding server/browser consent, and
controlled HTTP/SSE upstream. `recovery.mjs` exercises the same account/relay
modules and real Rust persistence with deterministic local fault controls.
See their README and [ADR 0299](../../adr/0299-mirrorcoding-account-relay.md).
The production origin is not part of automated acceptance.
