# MirrorCoding requirements: PI Android companion

Status: Client integration contract. MC implementation and deployment are owned
by the MirrorCoding team. The PI repository contains a controlled test fixture,
not a production MC server implementation.

## Outcome and ownership

A user shares a project or session from PI Desktop, signs into the Android app
with the same MC account, and enters a pairing code. The phone can then read
history and live agent output, continue conversations, send attachments, stop
tasks, answer questions, and resolve approvals. Image generation uses the
desktop's selected model, group, and parameters.

- PI owns the desktop, Android client, RACP operations, history, files, execution,
  and per-session permission decisions.
- MC owns account login, device identity, pairing, grants, presence, and relay.
- Both clients initiate outbound connections. There is no desktop inbound port.
- Desktop must be online. MC stores device/grant metadata only. It does not
  persist transcripts, attachments, model credentials, or offline commands.
- A project share includes current and future sessions belonging to that project.
  A session share includes only that session. PI resolves membership on use.
- Disconnecting a phone or revoking a grant does not stop a desktop task.

Production origin: `https://console.mirrorcoding.xyz`. Local test origins are
development configuration, not a user-facing server field.

## Common HTTP contract

Requests and responses use JSON, UTF-8, camelCase fields, and ISO-8601 UTC times.
Authentication uses `Authorization: Bearer <accessToken>`; never put account
tokens in URLs. All responses disable caching. Do not log credentials, pairing
codes, tickets, transcript content, or attachment payloads.

```json
{"success":true,"data":{}}
```

```json
{"success":false,"error":{"code":"DESKTOP_OFFLINE","message":"The desktop is offline"}}
```

Use HTTP 400 for invalid input, 401 for expired/invalid login, 403 for a wrong
account or scope, 404 for unavailable resources, 409 for already consumed codes
or conflicts, 410 for expired codes, 429 for throttling, and 503 for unavailable
relay service. Include `Retry-After` on 429/503 when known. Error codes include
`INVALID_CREDENTIALS`, `CHALLENGE_REQUIRED`, `INVALID_CHALLENGE`,
`AUTH_EXPIRED`, `PAIRING_INVALID`, `PAIRING_EXPIRED`, `PAIRING_CONSUMED`,
`ACCOUNT_MISMATCH`, `GRANT_REVOKED`, `DESKTOP_OFFLINE`, and `RELAY_UNAVAILABLE`.

Desktop authenticates with its existing `pi_desktop` token. Permit that token
to use its own sync device, pairing, grant and relay APIs. Mobile login issues a
separate device-bound mobile session; it must not provide desktop model tokens.
Account IDs are serialized as strings consistently across the new APIs.

## Native mobile account login

The existing website refresh-cookie flow is not the mobile contract. Reuse its
account/password checks, optional password-encryption policy, risk checks and
2FA without depending on a browser cookie jar.

| Method and path | Request | Successful data |
| --- | --- | --- |
| POST `/api/pi-mobile/auth/login` | `{username,password}` | `{session}` or `{challenge}` |
| POST `/api/pi-mobile/auth/challenge` | `{challengeId,code}` | `{session}` or another `{challenge}` |
| POST `/api/pi-mobile/auth/refresh` | `{refreshToken}` | `{session}` |
| POST `/api/pi-mobile/auth/logout` | `{refreshToken}` | `{}` |

```json
{
  "session": {
    "accessToken": "<opaque-mobile-access>",
    "refreshToken": "<opaque-mobile-refresh>",
    "expiresAt": "2026-09-21T12:15:00Z",
    "account": {"id":"901","name":"Example user"},
    "deviceId": "<registered-mobile-device-if-known>"
  }
}
```

```json
{
  "challenge": {
    "challengeId": "<opaque-challenge>",
    "type": "totp",
    "message": "Enter your verification code"
  }
}
```

Challenge types are `totp`, `email`, and `captcha`. A captcha challenge includes
an MC-hosted HTTPS `url`; completion supplies a one-use result as `code` to the
challenge endpoint. Define this handoff explicitly if the deployment enables
captcha. It must not silently disable the existing verification policy.

Return both replacement credentials on refresh. Keep the existing MC rotation
and concurrent-refresh behavior and document session expiry. Logout invalidates
the mobile session and closes its relay connections. Ordinary app restarts and
token refresh retain the registered device and pairings. Explicit logout clears
the phone's saved credentials and device registration; the next password login
registers a device and requires pairing again. The account can inspect and revoke
its old grants without granting a newly registered device access to their scopes.
Another device does not gain access merely by claiming an identifier.

## Devices, pairing and grants

| Method and path | Request / result |
| --- | --- |
| POST `/api/pi-sync/devices/register` | `{deviceId?,kind:"desktop"\|"mobile",name}` → `{deviceId}` |
| GET `/api/pi-sync/devices` | `{devices:[{deviceId,name,kind,online}]}`; visible paired desktops only for mobile |
| POST `/api/pi-sync/pairings` | `{deviceId,scope}` → `{pairing}` |
| POST `/api/pi-sync/pairings/{id}/cancel` | `{}` → `{}`; desktop owner only |
| POST `/api/pi-sync/pairings/claim` | `{code,deviceId}` → `{grant}` |
| GET `/api/pi-sync/grants` | `{grants:[...]}` for account grant management; desktop supplies `?deviceId=<desktopDeviceId>` to select its grants |
| POST `/api/pi-sync/grants/{id}/revoke` | `{}` → `{}`; authenticated owning account only |

```json
{
  "pairing": {
    "id":"pair-example",
    "code":"12345678",
    "expiresAt":"2026-09-21T12:10:00Z",
    "scope":{"kind":"project","id":"opaque-project-id","label":"My project"}
  }
}
```

```json
{
  "grant": {
    "id":"grant-example",
    "accountId":"901",
    "desktopDeviceId":"desktop-example",
    "mobileDeviceId":"mobile-example",
    "mobileDeviceName":"PI Android",
    "scope":{"kind":"session","id":"opaque-session-id","label":"Fix layout"},
    "createdAt":"2026-09-21T12:03:00Z"
  }
}
```

- Codes have eight digits, expire after ten minutes, and are consumed atomically.
- Bind the pending code to the authenticated desktop, account, and exact scope.
- On claim, require a mobile device owned by the same authenticated account.
  A failed wrong-account claim must not consume a valid owner's code.
- Device registration must not let one installation impersonate a paired device
  merely by submitting a caller-selected `deviceId`.
- Scope IDs are opaque MC metadata, not filesystem paths. MC must not expand
  project membership or interpret the RACP payload as a filesystem request.
- Persist grants across client/server restarts. Repeated revoke is successful.
- Account-level grant listing and revocation allow cleanup after a mobile logout
  or reinstall. Listing a grant is not permission for the current mobile device
  to use it; ticket issuance checks its exact `mobileDeviceId`.
- On claim/revoke, notify the desktop with `grants.changed`. A revoked mobile
  connection closes immediately; other scopes can reconnect using remaining
  grants. PI also checks current membership and local revocations.

## Online relay

### Tickets

`POST /api/pi-sync/relay/ticket` accepts `{deviceId}` from desktop or
`{deviceId,desktopDeviceId}` from mobile and returns:

```json
{"ticket":"<one-use-ticket>","expiresAt":"2026-09-21T12:01:00Z","url":"wss://console.mirrorcoding.xyz/api/pi-sync/relay/connect"}
```

Tickets expire after 60 seconds and bind account, role, device and target.
Mobile issuance requires at least one current grant and an online desktop.
The browser WebSocket connects to `url?ticket=...`; the ticket is consumed at
upgrade. Do not log its query string. The URL must use the configured MC origin.
Long-lived tokens are not used as query parameters.

### Frames

The mobile connection carries ordinary RACP JSON-RPC 2.0 text frames. The desktop
maintains one outbound socket; MC multiplexes mobile connections with these
envelopes. `peerId` is unique for the lifetime of the desktop connection.

```json
{
  "type":"peer.open",
  "peerId":"peer-1",
  "accountId":"901",
  "deviceId":"mobile-example",
  "grants":[{
    "id":"grant-example",
    "accountId":"901",
    "desktopDeviceId":"desktop-example",
    "mobileDeviceId":"mobile-example",
    "mobileDeviceName":"PI Android",
    "scope":{"kind":"session","id":"opaque-session-id","label":"Fix layout"},
    "createdAt":"2026-09-21T12:03:00Z"
  }]
}
```

```json
{"type":"peer.frame","peerId":"peer-1","frame":"{\"jsonrpc\":\"2.0\",\"id\":\"c1\",\"method\":\"connection/initialize\",\"params\":{}}"}
```

```json
{"type":"peer.close","peerId":"peer-1","reason":"disconnected"}
```

`peer.open` is server-generated and arrives before that peer's first frame.
Desktop replies using `peer.frame`; MC unwraps the `frame` string onto the
corresponding mobile socket. A desktop `peer.close` closes that peer only.
MC never accepts a phone-supplied peer/account/grant context. PI fetches current
grants through the authenticated HTTP API before admitting a peer; the envelope
does not replace that lookup.

Control frames are `{"type":"grants.changed"}`, `{"type":"ping"}` and
`{"type":"pong"}`. Reply to desktop `ping` with `pong`. PI sends a heartbeat
every 20 seconds and reconnects when no relay frame arrives for 60 seconds.
Relay envelopes preserve ordering within each peer.
Support at least 1 MiB UTF-8 frames; PI transfers attachments as ordered
192 KiB binary chunks encoded in RACP JSON, not one entire file in a frame.
Use bounded socket backpressure; close an overloaded connection explicitly
instead of silently losing frames. PI restores visible state from desktop.

### Disconnect and deployment behavior

- Desktop disconnect closes its mobile peers with `DESKTOP_OFFLINE`. There is
  no command queue or offline transcript endpoint.
- Revocation closes affected peers with `GRANT_REVOKED`; expired mobile login
  closes its sockets with `AUTH_EXPIRED`.
- Provide WSS through the existing reverse proxy with WebSocket upgrade and
  idle timeout support. Bind reconnects to the same logical device.
- Support Capacitor's Android `https://localhost` origin for the mobile API;
  local test browser origins belong only to local test configuration. Bearer
  APIs do not use credentialed cross-origin cookies.
- Live transcript and attachment content are transient relay data. Exclude
  frame bodies from access/error tracing and persistent queues.

## PI-owned operations (MC forwards without interpreting)

The restricted mobile profile is a subset of RACP JSON-RPC with the following
operations. Field names below match the PI client and desktop implementation.

| Method | Parameters / result |
| --- | --- |
| `connection/initialize` | `{protocolVersion,...}` → standard RACP initialization result |
| `connection/ping` | `{}` → `{ok:true,serverTime}` |
| `session/list` | `{grantId?}` → `{sessions}`; an optional grant selects exactly that shared project/session |
| `session/get` | `{sessionId}` → `{session}` |
| `session/attach` | `{sessionId,after?}` → RACP attach result with an enriched `session` and `snapshot` |
| `session/snapshot` | `{sessionId}` → `{snapshot}` |
| `session/history` | `{sessionId,beforeItemId?,limit?}` → `{items,hasMore,revision}`; default 50, maximum 200 items |
| `events/subscribe` | `{scope:"session",sessionId,after?}` → standard RACP subscription result |
| `events/ack` | `{subscriptionId,sequence}` → `{acknowledged:true}` |
| `events/unsubscribe` | `{subscriptionId}` → `{removed}` |
| `turn/start` | `{sessionId,input:{text,messageId,attachments?}}` → RACP chat admission result or `{accepted:true,jobId}` for image admission |
| `message/status` | `{sessionId,messageId}` → `{status:"running"\|"queued"\|"persisted"\|"unknown"}` |
| `turn/stop` | `{sessionId}` → cooperative stop result |
| `turn/interrupt` | `{sessionId}` → immediate runtime interruption result; used by the phone Stop button |
| `turn/cancel` | `{sessionId,turnId}` → queued-turn cancellation result |
| `approval/respond` | `{sessionId,approvalId,decision,permissionMode?}` → existing RACP approval result |
| `input/respond` | `{sessionId,inputId,answers}` → existing RACP question response result |
| `attachment/create` | `{sessionId,name,kind,mimeType?,size}` → `{uploadId,chunkBytes}` |
| `attachment/write` | `{sessionId,uploadId,offset,data}` → `{offset}`; `data` is base64 |
| `attachment/complete` | `{sessionId,uploadId}` → `{attachment:{id,name,kind,mimeType?,size}}` |
| `attachment/read` | `{sessionId,messageId,attachmentId,offset?}` → `{data,offset,nextOffset,size,eof,name,mimeType}` |
| `image/retryDownload` | `{sessionId,messageId,imageId}` → updated desktop message containing the image result; no new generation |

`MobileSession` adds desktop model/provider/group, task mode, saved image
configuration, and prompt/stop capabilities. `MobileSessionSnapshot` includes
the enriched session, existing RACP state, current `imageJobs`, and pending
`plans`. Plan approvals still use the existing approval operation.

Notifications use `events/event` and `events/closed`. Image progress is an
ephemeral `turn.activity` event with `{imageState}`. Desktop model/mode/image
configuration changes emit `turn.activity` with `{configurationChanged:true}`;
the phone refreshes the snapshot. Neither event increments the durable cursor.

Every new mobile message supplies a UUID `messageId`, which is preserved in the
desktop queue and persisted user message. If a send acknowledgement is lost,
the phone reconnects and calls `message/status` before offering another send.
`unknown` is not permission to automatically replay an image or agent request.

Completed upload references are `{id}`. Explicit historical references are
`{id,messageId}`; ordinary attachment IDs are their stored references, and image
IDs are the result image IDs. A peer can use only its completed uploads or
attachments already present in an authorized session message. Reconnecting
discards unfinished peer uploads; the phone retains its local draft/files.

The profile excludes session creation, model/configuration changes, arbitrary
Host RPC, host-wide subscriptions, terminals and filesystem paths.

PI enforces project/session membership on each operation and outbound event.
Desktop is the single task admission and persistence authority. Reconnection
obtains a snapshot and cursor; it never automatically repeats a generation.
Phones inherit desktop model/mode and permission settings. An approval already
resolved on desktop is not executed a second time on mobile.

## MC delivery and joint acceptance

Deliver a local runnable service and test-account setup, endpoint examples,
native login challenge instructions, and documented deployed interface version.
No production credentials belong in the handoff or PI fixtures.

The joint test must use actual PI Desktop and Android APK against that local
service. Test same/wrong accounts, code expiry/reuse/cancel, unrelated devices,
project/session grants, claim/revoke notifications, relay ordering, attachments,
refresh/logout, desktop/network disconnect and service restart. Demonstrate
that restart preserves metadata but does not deliver old queued commands or
expose unshared history. PI separately verifies the visible agent/image flows.

Passing the PI-controlled fixture proves client behavior only. Production
deployment and MC implementation acceptance are recorded separately.
