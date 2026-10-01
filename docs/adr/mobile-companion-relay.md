# ADR: Scoped MC relay for the Android companion

- Status: Accepted by the implementation request
- Date: 2026-09-21

## Context

Users need to inspect and continue selected desktop sessions from Android. PI
already owns turn admission, approvals, snapshots and history through AgentHost,
RACP and Rust. Image generation has a separate ImageService entry point. MC
already owns account identity, but its desktop model authorization is not a
mobile login or remote-control protocol.

## Decision

Build React/Capacitor Android in this monorepo, reuse PI presentation assets and
expose the existing RACP client through a browser-safe package entry. Shared
protocol errors live in shared, not the Node AgentHost implementation graph.

Both clients connect outward to an authenticated MC WSS relay. Desktop accepts
only an explicit mobile command profile and checks the current shared scope on
every operation/event. Rust persists the desktop share metadata; MC persists
device/grant metadata. The full transcript and files stay on desktop. No cloud
agent instance, offline command queue or inbound desktop server is introduced.

Reuse AgentHost for chat execution/approvals and ImageService for direct image
generation. The mobile view is another controller of the same desktop state.
Disconnect does not cancel tasks; reconnection reads current state without
automatically replaying uncertain mutations.

Expose model discovery and configuration only as scoped mobile operations.
Electron projects the desktop and MirrorCoding catalogs without credentials,
validates the complete model/group choice and image capability, and delegates
authoritative session persistence to Rust. The phone never manages providers.
Chat model/reasoning changes can persist as the next-turn selection while an
existing turn continues with its captured launch configuration; execution mode
changes remain gated by active work and approvals.

## Alternatives and consequences

Forking Happy (Expo) or HAPI (Kotlin/Hub) would introduce a separate UI and
execution protocol. A generic remote desktop/terminal would not preserve PI's
structured messages and approval semantics. Directly exposing the existing full
Host endpoint would exceed a project/session share.

The scoped relay requires MC login/pairing/relay work described in the separate
handoff. Until that service is delivered, only controlled local integration can
be accepted. The browser/mobile remote-control exclusion in the historical MVP
baseline is explicitly superseded for this opt-in feature. MC still treats model
catalog/configuration frames as opaque relay data and gains no model credential,
provider-management or transcript-storage responsibility.
