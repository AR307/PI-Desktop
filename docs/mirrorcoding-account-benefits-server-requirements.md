# MirrorCoding account benefits: server handoff

Status: **client implemented; proposed server contract, not server deployment evidence**.
Updated: 2026-10-25. Owner: MirrorCoding account/API backend.

## Goal and client delivery

A signed-in Pi user can manually claim the same daily reward as on the
MirrorCoding website and inspect every active subscription without leaving Pi.
The composer shows wallet balance in CNY to the left of a compact subscription
bar before the model picker. The bar appears only when an active plan has more
than CNY 0.50 remaining, or an active plan is unlimited. Hover reveals remaining
percentage; clicking the bar opens subscription/check-in details. Clicking the
balance asks for confirmation before opening the website wallet. Settings >
Account retains subscription details and check-in even when the bar is hidden.

This request does not implement or deploy server code, change billing, alter
model selection, add automatic check-in, or expose credentials to the renderer.
The client is usable against the contract below; production acceptance remains
blocked until the wallet extension is deployed, authorized and tested.

## Source observations and current server dependency

The initial 2026-10-18 inspection described the website-only benefit boundary
below. A read-only 2026-10-25 inspection of `service/pi_desktop_benefits.go` and
`router/api-router.go` in the local MirrorCoding source found the Pi benefits
and check-in endpoints, subscription/check-in permissions, `quota_per_unit`
and `quota_unit: "credits"`. It did not find wallet balance or authoritative
CNY conversion fields. This is local source evidence, not a deployed API test.
This client-only update requires the three additional fields documented below;
no backend file or deployment is changed by this task.

### Original authentication boundary

The inspected server checkout has Pi OAuth/catalog routes and website routes
`GET/POST /api/user/self/checkin` and `GET /api/subscription/self`. Website
routes use website UserAuth; the check-in POST also uses TurnstileCheck. Pi
uses client ID `pi-desktop`, scope `pi_desktop`, authorization code with PKCE
S256, and its own Bearer grant. Pi tokens are not website sessions.

Reference source: `router/api-router.go`, `controller/checkin.go`,
`controller/subscription.go`, `model/subscription.go`, and
`docs/pi-desktop-mirrorcoding-auth.md` in the MirrorCoding backend. These are
local source observations, not a claim about currently deployed routes.

Do not make Pi call web-session endpoints, copy browser cookies, require a
user API key, or bypass the existing verification/abuse protection. Add thin
Pi-authenticated handlers reusing the authoritative subscription and reward
services. The website and Pi must share the same check-in record and reward.

## Authorization additions

Keep the existing `pi-desktop` client and `pi_desktop` OAuth scope. The client
does not request invented extra OAuth scopes. Extend this grant's explicit
consent/capability set with:

| Effective permission | Authority | Consent wording meaning |
| --- | --- | --- |
| `subscriptions_read` | Read only the authorized user's active subscription names, expiry, consumed/total quota, reset and group restrictions | View my active subscriptions and remaining quota |
| `check_in` | Read today's check-in state and claim today's normal reward only after explicit user action | Perform my daily check-in |
| `wallet_read` | Read only the authorized user's wallet balance, separately from subscription quota | View my wallet balance |

The server must persist and enforce these effective permissions for the
grant; hiding a client button is not authorization. Bind the subject to the
token, never an input user ID. Revoke/expire benefits access together with
the Pi grant. Token refresh must not silently add consent. Do not grant
wallet spending, purchases, refunds, plan changes, admin access or access
to another user's subscriptions.

For grants without a capability, return its effective permission as false (or
HTTP 403 if the entire account-benefit capability is denied). Adding wallet
access must not revoke previously granted subscription/check-in capabilities.
New consent during normal reauthorization may grant the requested capabilities.
Update the authorization page to explain them. Existing chat/catalog access
must remain unaffected.
Client wording asks users to reauthorize once this server capability exists.

When `subscriptions_read` is false, return an empty subscriptions array. When
`check_in` is false, redact personal check-in state (`checked_in: false`,
`reward: null`); public feature availability, server day and timezone may
still be returned. The client disables the action.
When `wallet_read` is false, return `wallet_balance: null`. Wallet read access
does not authorize spending or a purchase; the website keeps its own login and
payment flow.

## Endpoints

Both are same-origin Pi endpoints using `Authorization: Bearer <Pi access
token>`. Both return the complete envelope below. Use no-store responses.
Neither endpoint accepts a target user ID or client-supplied quota/reward.

### GET /api/pi-desktop/account/benefits

Read effective permissions, wallet balance, conversion, active subscriptions
and today's check-in state.
Read must never claim a reward. The client reads on sign-in/account change,
opening the panel, visible-window focus, a visible 60-second interval, and
manual Refresh. Overlapping requests are shared in main. No local disk cache.

### POST /api/pi-desktop/account/checkin

No request body. Require `check_in`, a valid subject and enabled check-in.
Use the website's reward calculation, configured timezone and accounting
transaction. Enforce one reward per user per server-calendar day across
website and Pi, including concurrent requests and lost responses. A repeated
request returns HTTP 200 with `checked_in: true` and the existing day's
reward; it must not award twice. This also makes the existing one-time
OAuth 401 refresh/replay safe. There is no client network-error auto-replay.

Keep normal anti-abuse policy. If verification is required, return HTTP 403
with `error: verification_required`; Pi displays an explicit browser-
verification message rather than bypassing it. Users can finish check-in on
the website then refresh Pi. A future in-client challenge flow needs an
agreed challenge contract; it is not implemented here.

### Successful response (both endpoints)

```json
{
  "success": true,
  "data": {
    "permissions": {
      "subscriptions_read": true,
      "check_in": true,
      "wallet_read": true
    },
    "quota_per_unit": 500000,
    "quota_unit": "credits",
    "wallet_balance": 2500000,
    "quota_per_yuan": 100000,
    "subscriptions": [
      {
        "id": "123",
        "name": "Pro Monthly",
        "expires_at": "2026-11-18T00:00:00Z",
        "quota_total": 5000000,
        "quota_used": 1000000,
        "next_reset_at": "2026-10-19T00:00:00Z",
        "groups": ["default"]
      }
    ],
    "check_in": {
      "enabled": true,
      "checked_in": false,
      "date": "2026-10-18",
      "time_zone": "Asia/Shanghai",
      "reward": null
    }
  }
}
```

These are illustrative values, not production configuration. After check-in,
return `checked_in: true` and the awarded raw quota in `reward`, alongside
a freshly read wallet balance and subscription projection. Reward is **wallet
credit**, not an increase to subscription quota. Never combine wallet balance
into this bar.

### Field semantics

- Existing subscription/check-in fields shown are required. The wallet
  extension must be returned by an updated server on both endpoints. A server
  without the extension is treated as unknown, not a zero balance. IDs are
  unique nonempty strings; names and
  unit labels are nonempty display strings, never HTML.
- `quota_used`, finite `quota_total` and non-null `reward` are nonnegative
  safe integer quota amounts in the same unit. `quota_per_unit` is a positive
  safe integer from server configuration. Display amount = raw amount /
  quota_per_unit; the client never assumes a fixed conversion.
- `quota_total: null` means unlimited. **Map backend `total_amount == 0`
  (unlimited in the inspected model) to null.** API zero means finite zero
  capacity, not unlimited. `quota_used` may exceed total; remaining is clamped
  to zero for display, without altering authoritative consumption.
- Finite total/used describe the same current billing/reset period. Apply
  due resets before projecting and return the next future reset, or null
  when there is no reset. Do not mix lifetime usage with daily allowance.
- Return every currently active, started, unexpired usable subscription, not
  just the selected model's plan. Exclude canceled, refunded, disabled and
  not-yet-started plans according to authoritative business state. Client
  additionally filters expired entries. Empty array means no active plans.
- `groups` contains effective display restrictions, not privileged routing
  secrets. Empty array means unrestricted across groups; do not use empty
  to mean unknown. This bar does not authorize a selected model/group.
- Timestamps are RFC3339 with explicit Z/offset. `next_reset_at` may be null;
  `expires_at` is required for each subscription. Desktop displays timestamps
  in its local timezone.
- Check-in `date` is YYYY-MM-DD in the server-configured `time_zone` (IANA
  name). The server owns day rollover, enabled status and awarded amount.
  `reward: null` means unknown/not claimed; a zero reward is still numeric.

### Required wallet extension

| Field | Type and meaning |
| --- | --- |
| `permissions.wallet_read` | Boolean effective consent for reading the authenticated user's wallet. Missing means no wallet access. |
| `wallet_balance` | Signed safe integer raw wallet quota, or null when unavailable/not permitted. Zero is a real zero; a negative value represents real debt if supported. Never substitute subscription remaining quota. |
| `quota_per_yuan` | Positive finite number of raw quota units per CNY 1, or null when no authoritative CNY conversion is available. Fractional conversion values are valid. |

The server derives `quota_per_yuan` from its authoritative wallet/display
currency settings and any required currency conversion. Do not equate credits
or USD to CNY, and do not add a client exchange-rate constant. It applies to
wallet and subscription quota, which must use the same raw quota unit.
Conversion is not personal wallet data and may remain present when wallet read
permission is denied so the subscription visibility rule can still work.

Client display is `wallet_balance / quota_per_yuan`, formatted as CNY with two
decimal places. The example is CNY 25.00; these are fixture values, not real
account values. Finite-plan eligibility is evaluated before display rounding:
`quota_total - quota_used > 0.5 * quota_per_yuan`. Exact CNY 0.50 does not pass.
Several plans each at or below CNY 0.50 must not be summed to pass.

Until the fields exist, or if balance/conversion is null, the wallet control
shows an em dash with an unavailable explanation. Finite-plan bars stay hidden
when conversion is unknown; an active unlimited plan remains eligible. The
wallet control still asks for confirmation before opening
`https://console.mirrorcoding.xyz/wallet` through the existing external-browser
API. Cancel/Escape never navigates. No access token is appended to the URL.

### Errors

| Response | Client behavior |
| --- | --- |
| 401 | Existing OAuth refresh once; remaining invalid grant requires reauthorization |
| 403 | Explicit permission message; no check-in |
| 403 `{"error":"verification_required"}` | Explicit browser-verification message; no bypass |
| 404 / 501 | Server capability not enabled; unknown wallet, hidden bar, explicit message in Account settings |
| 429 / 5xx / network / timeout | Request failed; manual refresh or next read can recover |
| Malformed success payload | Invalid-data message, no fabricated quota |

Failures clear the previous displayed quota rather than rendering zero or
stale data as current. They do not remove catalog models or break chat.
Benefits HTTP requests carry a 15-second abort signal; OAuth refresh retains
its existing separate timeout policy. Never log Bearer credentials.

## Client display rules

- Wallet balance is always separate from the bar; unknown is not zero.
- Show the bar only if at least one active, unexpired plan is unlimited or
  individually has more than CNY 0.50 remaining. Otherwise hide it entirely,
  including missing conversion, no plans, exhausted, expired and error states.
- When a finite bar is visible, its percentage across all active plans is
  `sum(max(0, total - used)) / sum(total) * 100`, not an average of percentages.
- Greater than 50% is green, greater than 20% through 50% yellow, 20% or
  below red. A zero-capacity finite plan contributes zero remaining.
- Any active unlimited plan makes the account-wide bar full green with an
  Unlimited tooltip, not a fabricated percentage. Per-plan/group limits
  remain visible in details and still apply to model requests.
- The closed bar contains no text. Hover/accessible label shows percentage
  (one decimal at most). Click lists plan name, remaining/total, used, expiry,
  reset if supplied, and groups; check-in is an explicit button.

## Server acceptance and rollout

1. Add handlers and explicit consent/capability persistence, using existing
   Pi OAuth validation and authoritative account services.
2. Test old grant denied, newly consented grant allowed, selective denial,
   expired/revoked grant and cross-user attempts. Refresh must retain rights.
3. Verify website-first/Pi-first repeated check-in, parallel POSTs, response
   loss, server-day rollover, disabled check-in and verification-required.
   Exactly one wallet reward and unchanged subscription allowance are required.
4. Verify multiple plans, expiry, canceled/future plans, resets, unlimited,
   zero/exhausted/overused quota, unit conversion and group restrictions. Test
   wallet-only accounts, genuine zero and negative balances, missing/null
   wallet fields, denied wallet permission, fractional CNY conversion, exact
   CNY 0.50, just above it, and multiple small plans that must not be summed.
   After check-in, return the fresh wallet balance without changing plan quota.
5. Deploy server support and consent first. Reauthorize a designated QA user,
   then run real Pi/website parity checks with explicit account authorization.
6. Only after that live acceptance publish the client update. Existing desktop
   chat/catalog must work whether benefits is enabled or denied.

Client evidence: `node --test apps/desktop/test/mirrorcoding-benefits.test.mjs`
and `node scripts/e2e-mirrorcoding-benefits.mjs`. The latter uses the actual
composer, IPC handlers, account service and controlled local HTTP endpoint in
Chromium. Preload transport and credential persistence are fixtures. It is
not a real Electron/OS-keystore or production-provider certification.
