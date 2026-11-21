# ADR 0319: Inline External Imports in Owning Settings Destinations

## Status

Accepted

**Date:** 2026-10-04
**Decision:** D645

## Context

Settings had one Import destination combining four independent workflows — session,
model configuration, external skill, and external MCP import — although the capability
destinations already own the records those imports create.

## Decision

Remove the standalone Settings Import destination and move the external model, skill,
and MCP scan panels into their owning Settings pages, each staying explicit and using
the selected global or project filter. The Settings session-import UI is removed while
plugin session import, host RPC, IPC, and persistence stay unchanged.

## Consequences

- The Settings rail and search no longer expose an Import destination.
- Models, Skills, and MCP each expose their importer from their owning page.
- Import candidates and selected rows stay within one capability scope; a
  scope change clears the panel state.
- Existing plugin session import contracts continue to own session ingestion.
- No host protocol, plugin API, permission, or database migration is required.

## 2026-10-25 amendment

[Native Codex history import](codex-native-history-import.md) adds a scoped
first-party Sidebar and Project archive entry. Other session import contracts
and Models/Skills/MCP entrypoints retain this decision.
