# ADR 0307: MirrorCoding Account Provider With Model-Level Group Routing

## Status

Accepted

## Context

MirrorCoding authorization belongs to one account, while the catalog exposes
multiple billing groups that may expose the same model. Persisting one normal
Provider row per group made the settings surface group-first and duplicated
the model configuration. It also made model-level limits and reasoning
settings drift between groups.

The session contract still stores `providerId + modelId`. Existing sessions
must keep their explicit group route, so replacing group rows outright would
silently change historical requests.

## Decision

Catalog synchronization now creates one stable account-scoped MirrorCoding
Provider containing the union of authorized models and a complete group-route
projection. Each `ModelBinding` stores the selected `mirrorCodingGroupId` and
model-level runtime settings. Existing group-scoped rows remain enabled for
current sessions and are projected with the account model settings.

Electron resolves a request as follows:

1. Read model settings from the account-scoped row when available.
2. Resolve the group from the session's group Provider or the binding's
   `mirrorCodingGroupId`.
3. Bind the selected model and group to the main-process loopback relay.
4. Inject the account Bearer token and exactly one encoded group header.

The sidecar receives only the temporary loopback key. Other API-key and
vendor-account Providers keep their existing storage and request paths.

## Consequences

- Model settings are edited once per account model and apply to every selected
  group route.
- Group changes remain explicit and survive catalog refresh. An unavailable
  saved group is not replaced; the user must select a valid group.
- Historical sessions retain their group Provider identity and do not silently
  switch to the account default.
- The provider list contains an internal account projection in addition to
  retained group rows; renderer model menus keep the group rows as the
  selectable route identities and hide the projection from duplicate choices.

## Validation

Rust provider tests cover account projection, model-setting propagation and
refresh retention. Desktop typecheck and model-settings user-path tests cover
the model-first renderer surface. Live MirrorCoding acceptance remains
dependent on the controlled local MC service.

## Amendment: published capabilities and independent Fast (2026-09-30)

The client-management contract now publishes modes, per-endpoint Fast support,
and endpoint paths. The prior Claude-name override is removed: model identity
is not permission to use an undeclared endpoint. Native protocol preference
still applies when exact model metadata and the directory agree.

Fast follows each persisted session selection, rather than a global default.
Rust remains the only persistence owner. One main-process configuration service
serves IPC and mobile, replacing the renderer's private pending-selection queue.
A transient launch snapshot distinguishes running requests from next-turn edits,
including reconnecting phones; it is released by the existing turn finalizer.

A final payload hook composes pi's existing hooks instead of adding an adapter.
Subagents validate their own resolved binding, never inherit parent Fast, and
retain their own preference on resume. Explicit subagent authorization remains.
A missing resumed binding is an actionable error rather than an alternate-model
continuation. Costs and actual upstream acceleration are not inferred locally.
