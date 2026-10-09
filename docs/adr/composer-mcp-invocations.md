# ADR: Composer MCP Invocations

- Status: Accepted
- Date: 2026-10-04
- Related: #1377, ADR 0024, ADR 0219

## Context

Explicit MCP selection belongs in the composer alongside Skills and plugin
commands. Tool discovery, argument selection, execution and approval remain
owned by the runtime and Host.

## Decision

Catalog discovery refreshes enabled user MCP records and uses the runtime's
existing bounded connection path, including before the first session after
restart. The composer exposes ready servers with tools in the current project. Server entries use
`/mcp:<URI-encoded-server-id>`; individual tool entries append
`:<URI-encoded-tool-name>`. Entries carry `kind: "mcp"`, `mcpServerId`, and an
optional `mcpToolName` containing the full host tool name. Existing command
aliases retain precedence. Selecting an entry inserts text without connecting
a server or executing a tool. Connection addresses, credentials and tool
schemas stay out of the composer catalog.

Main revalidates the selection against the session project's current catalog
on prompt or steering submission. It preserves the typed text in `command`,
adds a short model-facing selection instruction, and forwards `mcpServerIds`
and optional `mcpToolNames` through internal RPC. The runtime matches the
catalog's authoritative server IDs. Server selection activates all
mode-allowed tools from that server; tool selection activates only the exact
requested tools after validating ownership and mode availability. Neither
selection removes tools already active in the session.

Selection and ToolSearch share deferred activation, but selection does not
use ToolSearch's result-count limit. Steering activates tools only when its
queued user message is consumed and synchronizes declarations before the
provider request. Existing session restoration and execution permissions
remain in effect. Missing selection fields preserve on-demand discovery.

Unavailable selections fail explicitly rather than becoming ordinary prompt
text or broadening to a whole-server selection. A cached menu entry cannot
bypass submission validation. Native Pi sessions cannot use Desktop-managed
MCP selections.

## Consequences and alternatives

The optional catalog and internal RPC fields reuse the existing execution
path without database, Plugin SDK or Host protocol changes. Server IDs are
validated at the sidecar boundary and do not become tool-schema fields.

Selection makes tools available but does not force execution. Main rejects a
server or tool command without task text or an attachment before opening a
turn, so the model cannot infer an operation from the selection alone. With
task text or attachment context, the model chooses arguments and calls. A
renderer-driven tool call would duplicate runtime argument selection and
permission handling.

## Unreleased user-facing change

Select a connected MCP server or one of its tools from the composer's `/`
menu and send a task. Existing tool approvals still apply.
