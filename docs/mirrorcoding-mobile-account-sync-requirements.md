# MirrorCoding mobile account sync requirements

Date: 2026-10-06. PI client increment; MC implementation and deployment are separate.

## Ownership and existing interfaces

Extend the native login, device registration, grants, pairing and relay service in
[the original contract](mirrorcoding-mobile-sync-requirements.md). PI owns
execution, history, attachments and mobile caches. MC persists device and grant
metadata only, never conversation content or pending offline commands.
Login/pairing rate limits remain independent of model traffic.

An account grant belongs to one MC account and one registered mobile device.
A computer is accessible through it only after that computer explicitly opts in.
Existing project/session grants retain their exact scopes.

## Desktop opt-in

`POST /api/pi-sync/devices/{deviceId}/sharing`

Authenticated as the owner desktop; body:

```json
{ "accountSyncEnabled": true }
```

Reply uses the existing envelope:

```json
{ "success": true, "data": { "accountSyncEnabled": true } }
```

Default false. Disabling removes account-derived access to that computer
immediately, while remaining project/session grants still apply. PI also enforces
the local opt-in independently. If this metadata request fails, PI keeps the
local setting and retries publication after reconnection; the UI reports failure.
This is not an offline model command.

`GET /api/pi-sync/devices` returns stable `deviceId`, `name`, `kind`,
`online`, and `accountSyncEnabled` for desktop rows. Include opted-in offline
computers, so phones retain the directory while a computer sleeps.
Devices and grants must be scoped to the authenticated account.

## Pair once, discover computers

Desktop creates the existing `POST /api/pi-sync/pairings` with its deviceId and:

```json
{ "scope": { "kind": "account", "id": "account-id", "label": "Account work" } }
```

MC verifies the account ID against authenticated identity and that the creating
computer opted in. Codes remain eight digits, ten minutes, one-use, same-account
claim only. Claim continues through `POST /api/pi-sync/pairings/claim` with the
registered mobile deviceId. The resulting grant is:

```json
{
  "id": "grant-account-phone",
  "accountId": "account-id",
  "mobileDeviceId": "phone-id",
  "mobileDeviceName": "PI Android",
  "scope": { "kind": "account", "id": "account-id", "label": "Account work" },
  "createdAt": "2026-10-06T00:00:00Z"
}
```

Account grants have no desktopDeviceId. Project/session grants still require it.
Grant queries from a phone include its account grant and scoped grants.
`GET /api/pi-sync/grants?deviceId=desktop-id` includes applicable account grants
for that opted-in computer as well as scoped grants. A third computer which
opts in later is discoverable without another claim. Other phones pair separately.

The existing revoke endpoint revokes the selected grant. Account-grant revoke
removes that phone's account-derived access to every computer; scoped grants
remain effective. Desktop opt-out affects just that computer.

## Relay and notifications

Ticket creation includes the target desktopDeviceId. At ticket issue and WSS
connect, require matching account/device identities plus an effective grant.
Do not rely on a ticket issued before revocation. Desktop `peer.open` includes
trusted accountId, mobileDeviceId and current applicable grants. PI checks each
directory, history, change, attachment and mutation request against local scope.

Desktop control notifications use `devices.changed` / `grants.changed`.
Phones receive JSON-RPC notifications on their active relay connections:

```json
{ "jsonrpc": "2.0", "method": "mobile.devicesChanged", "params": {} }
{ "jsonrpc": "2.0", "method": "mobile.grantsChanged", "params": {} }
```

Close a peer which has no remaining scope. Where a scoped grant remains,
update the trusted peer context, or reconnect it with that narrower context.
Notify after register, name/online/opt-in changes, claims and revocations.
When disconnected the phone refreshes metadata after reconnect/foreground;
it also polls metadata without transferring transcript bodies.

Forward these new PI RACP messages without interpreting or persisting content:
`directory/list` (cursor/limit), `directory/subscribe`,
`mobile.directoryChanged`, `session/changes` (sessionId/afterRevision/limit).
History/state snapshots include `syncRevision`. This is Rust's durable
transcript position, distinct from the live RACP epoch/sequence cursor.
Return existing scoped errors for offline, unauthorized, expired and unavailable
conditions. No model calls, model credentials or model request quota are involved.

## Cache and APK responsibilities

MC does not host versions or offline transcript history. The phone uses
AR307/Mirrorcoding-APP Releases and Android's installer. Already loaded messages
and downloaded attachments stay app-private, partitioned by account/computer/
session. Explicit logout or confirmed scope loss clears affected caches.
An offline phone cannot be remotely erased before it receives revocation.

## Local handoff acceptance

Provide a runnable local service, request examples and fixture-account setup.

1. Pair phone with computer A once; discover A and B after both opt in.
2. Opt in C later and receive device notification without a new code.
3. Reject wrong-account claim, expired code and another phone's device identity.
4. Opt out B while it is online/offline. Revoke the account grant; also test
   one remaining single-session grant and stale tickets.
5. Restart MC/PI/phone: device IDs, grants and opt-in remain, history stays on PI.
6. Forward paged directory, session changes and attachment frames unchanged.
7. Model request 429s do not throttle login, pairing or discovery.
8. Document reverse-proxy WSS timeouts and offline statuses.

PI controlled fixtures prove client wiring only. Record real MC joint acceptance
and production rollout separately.
