# ADR: Account discovery and persistent mobile history

- Date: 2026-10-06
- Status: Accepted by the implementation request
- Supersedes storage/recovery decisions in mobile-transcript-cache-and-delta-sync.md

## Context

The old 500-row tail and process-local event cursor required another snapshot
after desktop restart. Single-computer grants could not discover another opted-in
computer. These are separate authorization and history ownership concerns.

## Decision

Keep execution and transcript authority in Rust/AgentHost. Add a Rust-owned
revision and per-message latest change index with deletion tombstones. Store no
duplicate message body. Page queries carry their captured revision; only applied
global change pages advance the phone's durable sync position. Live RACP cursors
remain responsible for transient streaming and are not durable database versions.

Keep individual loaded messages and directory indexes in account/computer/session
scoped IndexedDB stores. Read pages locally before contacting desktop. Preserve
downloaded attachment bytes in the same private account boundary. Do not replace
history with snapshots after a missed replay window. The new client requires the
new sync contract rather than retaining the obsolete full-refresh branch.

MC account grants authorize one phone to discover opted-in computers. Local
desktop opt-in remains an independent access check. Existing narrower grants
remain narrower. Online revocation recalculates the union of remaining scopes;
an offline phone learns revocation only when it reconnects.

Use Android DownloadManager and the system package installer for updates from
AR307/Mirrorcoding-APP, preserving application identity and signing. No cloud
transcript database, background agent, offline command queue or web hot update is
introduced.

## Consequences

Loaded history can grow with usage; it is read in pages and storage errors are
visible. MC must implement the account-grant increment before real pairing can
use it. The first updater APK needs manual installation. Native installation,
controlled relay behavior and production MC behavior require separate evidence.
