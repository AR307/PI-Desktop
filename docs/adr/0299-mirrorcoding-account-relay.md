# ADR 0299: Main-owned MirrorCoding authorization and group relay

- Status: Accepted
- Date: 2026-09-20
- Scope: Approved MirrorCoding integration plan

## Context

MirrorCoding grants authorize an account with multiple model groups. A request
must carry its selected group and a rotating account credential. PI-Desktop
already persists provider/model pairs and runs pi in a Node sidecar. Adding a
second session-level group identity or copying account refresh tokens into the
sidecar would split ownership and complicate historical conversation behavior.

## Decision

Keep the frozen renderer → preload → main → Rust/sidecar process topology.
Rust projects each account/group into one managed provider using `config_json`;
existing session provider/model IDs remain the complete selection. Disable stale
rows instead of rewriting historical sessions or silently selecting a new group.

Main owns browser PKCE, safeStorage, refresh and revoke-only records. A dynamic
loopback HTTP relay gives the sidecar temporary local credentials and adds the
current upstream Bearer token plus encoded group. A request remains attached to
its explicit account, group and protocol. Reuse pi's four wire adapters, its
reasoning mapping, and models.dev metadata rather than implementing new SDKs.

The Google SDK does not expose a fetch injection point in the installed public
API. An AsyncLocalStorage scope carries the existing transport through its global
fetch calls. This preserves request isolation without swapping global fetch back
and forth while concurrent streams run.

## Alternatives and consequences

- A group column on sessions was rejected because provider/model already owns
  selection and all auxiliary calls consume the same resolved provider binding.
- Passing refresh tokens to the sidecar was rejected because main already owns
  account lifecycle and the renderer/sidecar only need a callable local binding.
- A new transport implementation was rejected because existing pi adapters own
  tool, thinking and stream serialization.

The relay adds one local HTTP hop and owns cancellation/backpressure cleanup.
Account/group records are managed, so editing their credentials or address in
the manual provider editor is disallowed. Existing manual providers and vendor
accounts retain their behavior. Protocol version 12 requires matching main,
sidecar and Rust builds; existing databases need no schema change.

## Evidence

Actual Electron/browser acceptance verifies native protocol requests, reasoning,
tool continuation, auxiliary calls, group selection and recovery against a local
MirrorCoding service. Fault-controlled HTTP/Rust acceptance covers token rotation,
concurrency, empty catalogs, account changes and deferred revocation. Production
deployment is deliberately separate from this local implementation.
