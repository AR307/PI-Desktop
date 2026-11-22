# ADR: Separate Subagent Model Opt-In from Definition Pins

- Status: Accepted for implementation
- Date: 2026-09-13
- Related: D278, ADR 0062, ADR 0089, ADR 0237, E2E-166, issues #286, #386

## Context

Electron resolved definition pins and automatically selectable models into one
credential-bearing `subagentProviders` map, and treating every map key as a
`Task.model` selection both advertised private pins and bypassed main's
`availableForSubagents` check. A definition pin expresses one delegate's default, not
permission to select that model for any delegate.

## Decision

Add an optional `subagentModelKeys: string[]` field to the internal Electron-to-
sidecar launch payload, runtime options, and reuse comparison. Main includes
only successfully resolved bindings independently marked
`availableForSubagents` on enabled providers. Reusing a resolved pin does not
skip this independent opt-in decision. `subagentProviders` continues to carry
all resolved bindings so existing definition defaults keep working. Every
selectable catalog entry uses its exact provider ID/model ID key, so channels
with the same model never overwrite one another. MirrorCoding account models
own opt-in and settings; every enabled, currently authorized text-capable group
gets a separate routing entry. A stale account default group does not hide the
other groups. Ambiguous account aliases require an explicit channel choice.
One account's opt-in cannot authorize another account's pinned credentials.

The runtime uses those keys for its model summary, and missing keys mean no cached
override authorization. Other keys still pass `provider.resolveSubagentModel`, whose
response may fill a separate override cache that never takes part in launch reuse
matching; on-demand matching uses the same unique id, vendor, and name rule and fails
closed on ambiguous aliases, a changed launch list retires an idle runtime on the next
prompt, and on-demand grants expire at every new parent prompt or approved plan/goal
execution.

The opt-in belongs to the decision, not to the Task tool: it governs every
entry point through which the AI picks a model for work it delegates.
`session/collaboration/spawn` is the second such entry point (ADR 0237), and
its `modelKey` is that same selection written by a plugin on the agent's
behalf, so an unopted model is refused with `PERMISSION_DENIED` before a worker
exists. The inheritance half is unchanged: omitting `modelKey` still takes the
first opted-in model and otherwise the default, and naming the default model's
own key is that inheritance spelled out, exactly as repeating a definition's
own pin is on the Task path. `models.list` keeps reporting every ready model
with its `availableForSubagents` flag — the flag is advice to the caller and
authority only in main, which is the side a plugin cannot rewrite (#386).

D278's priority remains Task.model → definition pin → session model. The
existing exact-session-model exception remains unchanged. Repeating the
target definition's own pin key selects that pin, so catalog echo does not
become a tool error. The Task catalog displays each definition
default and says that omitting or repeating that key keeps it; this does not
prohibit deliberately selecting an opted-in override for a different model.

An explicit Task.model or a resume never follows a definition's fallback model
list. Task startup text and structured details report the actual model,
provider/channel, group and native reasoning. Resume retains the recorded
model key and MC group, including after history reconstruction; an unavailable
binding produces an error rather than inheriting the parent's model. Failure
is not authorization for the parent to claim or substitute the requested model.

## Consequences

- No provider credential leaves its process boundary, and no host RPC, setting,
  schema, or Plugin SDK change is required.
- Callers omitting the field keep definition defaults and session inheritance, while
  explicit overrides require on-demand authorization and fail closed without it.
- Reversing model-selection priority stays a product decision outside this fix.
