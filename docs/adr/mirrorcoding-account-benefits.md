# ADR mirrorcoding-account-benefits: MirrorCoding account benefits in Electron main

Date: 2026-10-18

## Status

Accepted for client implementation; server contract pending

## Context

Users need subscription quota and the website's daily reward from the signed-in
desktop. Existing Pi OAuth tokens belong to main; website sessions are a
different boundary. Catalog refresh mutates model projections and should not
be repurposed for frequent account quota reads.

## Decision

Add a small main-owned account benefits service using the existing account
request/refresh path. Expose only parsed public benefits through two additive
main-window-only IPC channels, `pi-desktop/mirrorcoding/benefits` and
`pi-desktop/mirrorcoding/checkIn`. Keep subscription aggregation pure and UI
loading/lifecycle in an account feature hook. The composer and Account settings
reuse one details component and the existing anchored-menu/button primitives.

The POST is explicit user action, not a timer or agent tool. Effective rights
and daily reward idempotency belong to the server. No browser cookies,
renderer Bearer token, fallback web endpoint or new persistence is introduced.
The existing OAuth scope remains unchanged; new effective permissions require
server consent support.

## Alternatives and consequences

- Calling website APIs from renderer would cross the authentication boundary
  and require web-session credentials; rejected.
- Adding quota to catalog would couple periodic quota refresh to provider
  mutation; rejected.
- A separate disk cache/store adds stale-account state with no current need;
  rejected. Main shares in-flight requests and clears data on identity change.

Old servers display an explicit unavailable state; chat is unaffected. The
client's controlled acceptance does not prove server authorization or live
billing. See [server requirements](../mirrorcoding-account-benefits-server-requirements.md)
for the exact contract, rollout dependency and acceptance cases. No database,
plugin, agent-tool or mobile protocol changes are needed.

## 2026-10-25 wallet display amendment

Reuse the same benefits response and main-owned parser for wallet read consent,
raw wallet balance and authoritative CNY conversion. Keep the balance separate
from subscription aggregation and claim rewards; no new endpoint or credential
transport is needed. The composer only displays a subscription bar if a single
active plan has more than CNY 0.50 remaining, or is unlimited.

A small wallet control owns confirmation and external-navigation state, reusing
the account dialog and existing browser API. It is keyed to account identity
so a previous account's dialog cannot persist after switching accounts. Unknown
values stay unknown; missing conversion does not invent an exchange rate.
Settings retain access to subscription details even when the bar is hidden.
The server extension is documented, not implemented or deployed by this change.
