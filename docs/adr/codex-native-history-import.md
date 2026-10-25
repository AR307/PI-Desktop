# Explicit native Codex import with separate history and continuation

Status: Implemented candidate

## Context

Users need to continue selected Codex work with PI models and tools. Loading a
Codex-owned ACP session would preserve execution ownership in Codex rather than
produce a native PI conversation. Copying visible UI messages alone loses
compaction and paginated history. Replaying old tool calls risks duplicate effects.

## Decision

Add a scoped first-party Codex importer in Rust Host. Keep two projections: a
readable native transcript, and effective continuation messages restored through
the existing native checkpoint. Source instructions are not PI instructions,
and completed tools are historical material. Host owns source identities and
project mapping; Renderer only submits selections and explicit mappings.

Reuse existing attachment storage, KV project mappings, model configuration and
approval mechanisms. No additional Agent, source-history snapshot, continuous
sync or model-generated summary is introduced. Main remains a thin bridge.

The sidebar hint is product discovery, independent of importer lifecycle. Its
session-only dismissal lives in Main; permanent visibility is a device-local
preference. One shared wizard serves Sidebar and Project archive.

This amends ADR 0319 only for the explicit Codex native-history feature. Existing
plugin import contracts and Models/Skills/MCP import destinations are unchanged.

## Consequences

Imported sessions continue independently with PI. Duplicate source IDs never
overwrite them. Missing directories block continuation until explicitly bound.
Unknown context requires explicit consent: retain usable context with a visible
partial-recovery notice, or import history only. With no usable context, only the
latter is available. Rejecting every incomplete source would discard useful
native compaction results; silently claiming full restoration would mislead the
user. No source credentials or permission grants become active.

Source adapters distinguish logical conversations from physical history segments
and stream native Zstd files. Native message identities include the destination
conversation so importing forks cannot collide on inherited source records.

The format adapter must track upstream changes with fixtures. Streaming source
reads avoid sampling, but native conversion currently materializes one session
in memory. Atomicity follows existing native import semantics; cancellation
keeps completed items rather than rolling back unrelated successful imports.

## Alternatives

- ACP session loading: rejected because Codex would still own execution.
- Re-summarize with a model: rejected because it costs tokens and changes evidence.
- Copy full Codex data/config: rejected because it includes unrelated state and
  would not give PI native ownership.
