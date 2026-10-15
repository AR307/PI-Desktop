# ADR 0321: Pin an acceptable address for mixed direct DNS answers

- Status: Accepted
- Date: 2026-10-06
- Deciders: PI-Desktop core
- Related: ADR 0243, ADR 0272

## Context

The Skill Market validates each address returned by the local resolver, then
uses Chromium `net.fetch`. On a direct route, a DNS response that contains a
usable public IPv4 address plus a synthetic ULA IPv6 address is rejected, even
though Main can safely connect to the public IPv4 address. Under a TUN fake-IP
resolver, the accepted `198.18.0.0/15` placeholder may also appear beside a ULA
IPv6 placeholder; `net.fetch` can select the rejected IPv6 result after the
guard has accepted the IPv4 result.

## Decision

1. On a `direct` route only, if at least one DNS result is rejected and an
   acceptable result exists, the Skill Market may select one acceptable result
   and pin the direct request to that exact address. For third-party content,
   prefer a public address; the `benchmark` range is eligible only under the
   existing fake-IP opt-in. A user-supplied first-hop endpoint keeps its
   existing user-endpoint address policy.
2. The pinned transport preserves the original hostname for TLS SNI and the
   HTTP `Host` header, disables automatic redirects, and respects the existing
   request abort signal. Every redirect is resolved, checked, and pinned again.
3. A ULA-only DNS result, or any other answer with no acceptable address,
   remains refused. Proxied and `unknown` routes keep ADR 0272's existing
   address verdict.

## Consequences

- Dual-stack and transparent-proxy answers no longer fail solely because an
  unused ULA result accompanies a public address or an explicitly permitted
  benchmark fake-IP. Main never connects to the ignored result.
- Direct mixed-answer requests use Node's HTTP(S) transport with the selected
  address pinned. Proxied requests remain on Chromium's `net.fetch` stack.
- This does not permit internal destinations, alter the persisted network
  policy, or change the URL/redirect rules. A resolver that returns only a
  private address still fails closed.

## Alternatives

- Permit all ULA answers on a direct route: rejected because ULA can name a real
  LAN or VPN service and would weaken the third-party network boundary.
- Keep using `net.fetch` after accepting one address: rejected because Chromium
  may resolve the hostname again and connect to the rejected address.
- Require users to disable IPv6 or change proxy DNS: rejected as the sole fix
  because Main can safely pin an already acceptable address without requiring
  system network changes.
