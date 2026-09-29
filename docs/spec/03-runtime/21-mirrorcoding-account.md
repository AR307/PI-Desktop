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
model; an unavailable group is replaced only during catalog reconciliation.

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

## Claude chat protocol (2026-09-29)

For MC-authorized chat models only, the original catalog model ID containing
claude (case-insensitive) selects Anthropic Messages /v1/messages. This
policy is shared by catalog compilation, new runtime bindings, and relay
validation; stale OpenAI annotations cannot override it. Original IDs, group
authorization and model settings remain unchanged. Images and other provider
sources retain their existing routes. A rejected Messages request surfaces
without protocol, model or group fallback. Already active requests keep their
selected protocol.
