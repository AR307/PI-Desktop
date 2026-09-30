# MirrorCoding Account And Model Routing

MirrorCoding authorization is owned by Electron main and stored through
`safeStorage`. Renderer and Node sidecar processes receive account metadata,
model catalog data, and a short-lived loopback relay key; they never receive
the access or refresh token.

## Provider projection

Catalog synchronization keeps the existing group-scoped Provider rows for
historical session identities and creates one stable account-scoped Provider
per authorized account. The account row stores the union of callable models,
all group route metadata, billing ratios, image capabilities, and model-level
settings. `ModelBinding.mirrorCodingGroupId` identifies the selected group for
an account model.

The account row is a settings projection rather than a second selectable route
in the composer. Group rows remain the explicit `providerId` route for session
history. Updating account model settings projects context, output, temperature,
reasoning defaults, and the selected group to the retained group rows. A
catalog refresh preserves a selected group while that group still exposes the
model; an unavailable selection stays visible as invalid until the user chooses again.

## Request path

```text
session providerId + modelId
  -> Electron resolves account binding and explicit group route
  -> loopback relay binding
  -> MirrorCoding Bearer + encoded X-Mirrorcoding-Group
  -> declared chat/image endpoint
```

The relay validates the model, selected group, endpoint and current catalog on
every request. It does not switch model, group, endpoint, or account after an
error. Existing non-MirrorCoding Provider and credential paths are unchanged.

## Persistence and recovery

An empty successful catalog disables the managed rows. A failed refresh keeps
the last usable catalog. Historical sessions retain their provider identity;
logout disables managed rows and clears the account credential through the
existing revocation flow.

## Published permissions and protocol selection (2026-09-30)

The MC client-management catalog is authoritative. A group model needs text
mode for chat, or image mode plus image capabilities for generation. The same
ID in another group grants no permission. Store modes, endpoint types, Fast
capabilities and auto candidate groups without combining group permissions.

Select from the intersection of the group's endpoints, root supported_endpoints
and connected pi adapters. Exact known-model metadata prefers its native
protocol only when permitted; otherwise use Responses, Chat Completions,
Anthropic, Gemini order. Model names never grant an endpoint. This replaces the
2026-09-29 Claude-name override. Local SDK paths map to published upstream paths;
original IDs, user reasoning parameters and group identity remain unchanged.
No request-time protocol, model or group substitution is allowed.

## Fast requests

Fast is a per-session next-turn preference, off for new sessions. Rust stores
it alongside existing settings, atomically with provider/model updates. Main
coordinates both desktop and mobile writes and pushes configuration changes.
Current tasks capture their launch settings; edits do not change tool
continuations. Queued tasks read the persisted selection when actually launched.
Mobile reconnects read this launch snapshot rather than sampling saved settings.

Fast is enabled only for the selected model/group/Chat-or-Responses endpoint
when declared by the directory. The native model panel shows requested Fast,
not a guarantee of acceleration or a client-computed surcharge. Switching to an
unsupported combination clears the next-turn preference with a visible notice.

The final pi payload hook composes existing extension hooks, preserving reasoning
and limits, then writes service_tier: fast. Off omits the field. Images, titles,
prompt enhancement and compaction do not inherit Fast. Relay rechecks current
capability before dispatch; credentials remain exclusively in main.

Task.fast is independent of the parent. New runs default off; resume omission
retains the child's previous value, and explicit values change the resumed run.
Authorization to use a subagent model is still explicit. Unsupported Fast fails
before starting the child. Parallel children keep independent settings, including
tool continuation and durable delegation details. Resume cannot replace a missing
model. MC failures never downgrade speed or select an alternate model/group.

pi_fast_unavailable and model_or_group_unavailable refresh the directory and
preserve input. invalid_service_tier is non-retryable; 402 is a balance/subscription
error without removing models. Existing 401 renewal and pre-output 429/503 retry
boundaries remain. Final request diagnostics record protocol/model/group/tier,
never credentials or prompt bodies.
