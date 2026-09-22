# MirrorCoding delta: PI Mobile session controls

Status: Incremental server-team handoff, revision 2026-09-22.

This document supplements
[`mirrorcoding-mobile-sync-requirements.md`](mirrorcoding-mobile-sync-requirements.md).
The base document remains authoritative for native login, devices, pairing,
grants, relay tickets, connection lifecycle, and share scope. This delta covers
the model, reasoning, mode, and image settings added to the Android companion.

## Executive decision

The new controls do **not** require a new MC business API, database table,
model-catalog service, model invocation path, or configuration store. PI Desktop
owns the catalog, validates changes, persists the session configuration, and
executes the selected model. The Android app exchanges the two new PI-owned RACP
methods through the existing WSS relay:

- `session/modelCatalog`
- `session/configure`

Configuration changes are announced through the existing `events/event`
notification with a `turn.activity` event whose payload contains
`{"configurationChanged":true}`.

MC needs a code change only when its current relay does at least one of the
following:

1. allowlists JSON-RPC method names and does not yet allow both methods;
2. parses, validates, rewrites, or reserializes the inner `frame` value;
3. cannot carry a logical inner frame of 1,048,576 UTF-8 bytes plus the outer
   `peer.frame` JSON envelope and escaping overhead;
4. persists, logs, queues, deduplicates, or automatically replays frame bodies.

If none applies, MC only needs to run the compatibility acceptance in this
document and report the result. No server feature development is required.

## Change matrix

| Surface | MC action |
| --- | --- |
| `/api/pi-mobile/auth/*` | No change. Keep the base mobile login and refresh contract. |
| `/api/pi-sync/devices/*` | No change. |
| `/api/pi-sync/pairings/*` | No change. |
| `/api/pi-sync/grants/*` | No change. Existing account, device, and scope checks still apply. |
| `POST /api/pi-sync/relay/ticket` | No request or response change. |
| `/api/pi-sync/relay/connect` | Verify opaque forwarding, ordering, size limits, and no replay. Patch only if the current relay violates these requirements. |
| MC persistence | No new records. Do not store catalogs or session configuration. |
| MC model gateway | No change. These controls do not call a model through MC directly. |
| PI Desktop and Android | PI owns all new schemas, validation, persistence, UI, and execution. |

Authentication, pairing, grant revocation, ticket expiry, online presence, and
scope isolation are unchanged. A phone authenticated to the same account still
cannot access a session without a current grant.

## Relay compatibility requirements

The phone sends ordinary JSON-RPC 2.0 text frames. MC routes each complete inner
frame to the authorized desktop using the existing envelope:

```json
{
  "type": "peer.frame",
  "peerId": "peer-1",
  "frame": "{\"jsonrpc\":\"2.0\",\"id\":\"catalog-1\",\"method\":\"session/modelCatalog\",\"params\":{\"sessionId\":\"session-1\"}}"
}
```

Desktop responses use the same envelope in the opposite direction. MC unwraps
the `frame` string and writes it to the matching mobile socket unchanged.

The relay must:

- preserve every inner JSON-RPC request ID, method, parameter, result, error,
  notification, string, number, array, and object without normalization;
- preserve frame order within one `peerId`; no ordering is required across
  unrelated peers;
- route responses and notifications only to the mobile peer represented by that
  `peerId` and its current grants;
- forward PI-generated JSON-RPC errors unchanged, including unknown future
  fields in `error.data`;
- never turn a PI error into an HTTP success/error schema or a relay close;
- never retry or replay `session/configure` or another inner request after a
  disconnect, timeout, or uncertain delivery;
- keep frame bodies out of persistent queues, database records, access logs,
  error logs, analytics, and tracing payloads;
- apply backpressure and close explicitly on overload rather than dropping or
  reordering frames.

MC necessarily parses the outer relay envelope to route `peerId`. It must treat
the inner `frame` as an opaque string. A generic relay should not need a method
allowlist. If the deployed implementation has one, add the two methods above and
continue forwarding `events/event`; do not add MC-side field validation.

PI advertises `maxFrameBytes: 1048576` during `connection/initialize`. This is
the maximum UTF-8 size of the decoded inner RACP frame. The desktop-side WSS
payload can be larger because that string is nested and escaped inside a
`peer.frame` envelope. Configure MC and its reverse proxy to carry the complete
outer envelope for any valid 1 MiB inner frame. Do not set the physical desktop
WebSocket limit to exactly 1 MiB.

## PI-owned protocol additions

The examples below show inner RACP frames. They are payload, not new MC HTTP
endpoints. Identifiers are illustrative and opaque to MC.

### Read the desktop model catalog

Request:

```json
{
  "jsonrpc": "2.0",
  "id": "catalog-1",
  "method": "session/modelCatalog",
  "params": {
    "sessionId": "session-1"
  }
}
```

Representative response:

```json
{
  "jsonrpc": "2.0",
  "id": "catalog-1",
  "result": {
    "catalog": {
      "chat": [
        {
          "providerId": "managed-provider-group-priority",
          "providerName": "MirrorCoding / Priority",
          "modelId": "gpt-5",
          "displayName": "gpt-5",
          "source": "mirrorcoding",
          "groupId": "priority",
          "groupName": "Priority",
          "groupDescription": "Example group",
          "ratio": 0.06,
          "dynamicBilling": false,
          "supportsReasoning": true,
          "supportedThinkingLevels": ["low", "medium", "high"],
          "supportsVision": true,
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        }
      ],
      "image": [
        {
          "providerId": "managed-provider-group-priority",
          "providerName": "MirrorCoding / Priority",
          "modelId": "gpt-image-example",
          "displayName": "GPT Image Example",
          "source": "mirrorcoding",
          "groupId": "priority",
          "groupName": "Priority",
          "ratio": 0.08,
          "dynamicBilling": false,
          "supportsReasoning": false,
          "supportedThinkingLevels": [],
          "supportsVision": true,
          "image": {
            "generation_path": "/v1/images/generations",
            "reference_path": "/v1/images/edits",
            "sizes": ["1024x1024"],
            "qualities": ["standard", "high"],
            "aspect_ratios": ["1:1"],
            "max_count": 4,
            "supports_chat": false
          }
        }
      ]
    }
  }
}
```

The response is a display-only projection. It contains no access token, refresh
token, API key, authorization header, provider secret, or private base URL. MC
must still treat it as transient frame content and must not persist or index it.

### Save model, group, reasoning, or mode

Chat selection request:

```json
{
  "jsonrpc": "2.0",
  "id": "configure-1",
  "method": "session/configure",
  "params": {
    "sessionId": "session-1",
    "mode": "agent",
    "providerId": "managed-provider-group-priority",
    "modelId": "gpt-5",
    "thinkingLevel": "high",
    "context": {
      "requestId": "2ee2af6c-443b-4f2d-a55f-e3fc401f88f5"
    }
  }
}
```

Image selection request:

```json
{
  "jsonrpc": "2.0",
  "id": "configure-2",
  "method": "session/configure",
  "params": {
    "sessionId": "session-1",
    "mode": "image",
    "providerId": "managed-provider-group-priority",
    "modelId": "gpt-image-example",
    "imageConfig": {
      "active": true,
      "providerId": "managed-provider-group-priority",
      "modelId": "gpt-image-example",
      "options": {
        "size": "1024x1024",
        "quality": "high",
        "aspectRatio": "1:1",
        "count": 1
      }
    },
    "context": {
      "requestId": "f55914dd-08a1-4554-b768-5a226b24faef"
    }
  }
}
```

`providerId` and `modelId` form one atomic selection. For a MirrorCoding model,
the PI-managed provider identifies the exact group. MC must not derive, replace,
or validate the group from `groupId`, `groupName`, or the model name.

PI returns the updated `session`. Its `configuration.current`, when present,
describes the active task's captured settings; `configuration.next` describes
the persisted settings for the next admitted turn. During a running chat task,
PI can accept a new model/group/reasoning selection for `next` while leaving
`current` unchanged. MC forwards that response and does not delay the mutation.

Mode changes are rejected while a task or Plan/Goal approval is active. Image
settings are fixed during a running image job. PI also rejects read-only
sessions, stale models/groups, unsupported reasoning levels, and undeclared
image parameters.

Representative PI error:

```json
{
  "jsonrpc": "2.0",
  "id": "configure-2",
  "error": {
    "code": -32000,
    "message": "SESSION_CONFIGURATION_BUSY",
    "data": {
      "code": "CONFLICT",
      "message": "SESSION_CONFIGURATION_BUSY",
      "retriable": false,
      "traceId": "opaque-trace-id"
    }
  }
}
```

Other expected PI errors include `FORBIDDEN` for a read-only or revoked share
and `INVALID_ARGUMENT` for an unavailable model/group or unsupported parameter.
MC must not translate, retry, or replace these responses.

### Notify both clients of a configuration change

After the phone or desktop changes the shared session configuration, PI emits an
ordinary RACP notification to subscribed mobile peers:

```json
{
  "jsonrpc": "2.0",
  "method": "events/event",
  "params": {
    "eventId": "2f47b031-54a8-4f15-b41f-cf5cb62036f8",
    "scope": "session",
    "sessionId": "session-1",
    "epoch": "desktop-epoch",
    "afterSequence": 42,
    "revision": 8,
    "kind": "turn.activity",
    "occurredAt": "2026-09-22T08:00:00.000Z",
    "payload": {
      "configurationChanged": true
    }
  }
}
```

This activity event is a refresh hint and does not advance the durable history
cursor. The phone obtains authoritative state with `session/snapshot`. MC must
not coalesce this event, synthesize configuration state, or cache a snapshot.

## Failure and reconnect behavior

- A lost `session/modelCatalog` request is safe for the phone to request again.
- A lost or uncertain `session/configure` response is **not** replayed by MC.
  After reconnect, the phone reads `session/snapshot` to determine the saved
  state.
- A disconnected phone keeps only its local draft. MC does not queue a mode or
  model change for later delivery.
- Revoking the grant immediately closes the affected peer. A later frame cannot
  restore access without a new valid grant.
- Desktop offline, mobile authentication expiry, and grant revocation retain the
  base contract's distinct close reasons.
- Unknown future fields or catalog entries are forwarded unchanged. Their
  meaning and validation remain PI-owned.

## Joint acceptance

Run these cases against the MC team's local service with actual PI Desktop and
the current Android app:

1. Pair the same account and complete `connection/initialize` using the existing
   device, grant, ticket, and WSS flow.
2. Request `session/modelCatalog`; verify both chat and image lists arrive and
   that an MC model with multiple groups remains multiple choices with distinct
   opaque `providerId` values.
3. Save a chat model, group, and reasoning level; verify the response and a new
   snapshot contain the same selection.
4. While a chat turn is running, save a different model/group/reasoning choice;
   verify `current` remains unchanged and `next` contains the new choice.
5. Attempt to switch mode during a running task and during a pending Plan/Goal
   approval; verify PI's `CONFLICT` response reaches the phone unchanged.
6. Exercise Agent, Plan, Goal, and Image modes. Save declared image size, aspect
   ratio, quality, and count and verify a later snapshot returns them.
7. Exercise read-only scope, revoked grant, unavailable model/group, and invalid
   image option errors; verify MC does not rewrite or retry them.
8. Change the configuration on desktop; verify the phone receives
   `turn.activity` with `configurationChanged:true` and refreshes its snapshot.
9. Drop the socket after a configuration request has been sent. Verify MC does
   not replay it and the reconnected phone resolves state from a snapshot.
10. Revoke the grant and verify further catalog/configuration requests cannot
    reach the desktop under that peer.
11. Carry a logical inner frame at the negotiated 1 MiB boundary through the
    phone socket, desktop envelope, reverse proxy, and relay without truncation
    or silent loss; verify an oversized frame is rejected explicitly.
12. Inspect MC storage and sanitized operational logs. Confirm they contain no
    model catalog, provider/model selection, image settings, request/response
    frame body, token, pairing code, ticket, transcript, or attachment payload.

The existing PI-controlled relay fixture already verifies client behavior. It
does not prove that the deployed MC relay, proxy limits, logs, or method filters
meet this contract.

## MC team delivery

Return the following to the PI team:

1. A completed change-matrix statement confirming whether the deployed relay
   has a JSON-RPC method allowlist, inner-frame parser/rewriter, automatic replay,
   frame-body logging/persistence, or a payload limit below this contract.
2. A patch and local runnable service only for the incompatible items found.
3. The effective WSS application and reverse-proxy payload limits, including how
   outer `peer.frame` escaping overhead is accommodated.
4. Joint-acceptance results for all twelve scenarios, with deployed interface
   version and environment. Logs and fixtures must contain no production
   credentials or user data.

If the matrix confirms an opaque ordered relay with sufficient limits and all
acceptance cases pass, MC may close this delta as **no server code change
required**.
