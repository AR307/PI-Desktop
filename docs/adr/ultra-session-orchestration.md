# ADR: Ultra session orchestration

- Status: Implemented candidate, 2026-10-01

## Context

Provider reasoning ladders differ. PI already owns background workers, model
authorization, scoped tools, stop/wait operations and durable transcript rows.
A second executor or a provider `ultra` value would duplicate or break them.

## Decision

Keep Ultra as a session boolean and resolve native reasoning per model at launch.
One runtime policy module supplies both system/tool guidance and child level
selection. Rust remains the persistence owner, Node the execution owner, and
desktop/mobile the configuration clients. Existing Task workers run unchanged.

Idle parent provider rebinding leaves worker snapshots alive. Extensions and
tool-catalog lifecycle changes still use the existing runtime lifecycle. The
existing Task settlement event updates its original Rust-owned row rather than
being discarded as a duplicate. Persisted child bindings support exact resume.

## Asynchronous handoff amendment, 2026-10-01

The earlier guidance encouraged the parent to keep working and only allowed it
to end. Real use produced repeated short TaskWait calls and unrelated parent
work while a delegate was still executing. A longer timeout would preserve the
wrong lifecycle, and prompt-only wording would still rely on model compliance.

After a successful Ultra Task batch, use pi-agent-core's native finishTurn hook
to end the parent run before another provider request. The hook runs after every
tool result, so parallel fan-out is not cut off after the first worker. Reports
that race with the handoff go through the existing silent wake queue after end
events rather than holding the dispatch turn open. No abort, new scheduler,
worker registry or host protocol is introduced. Normal mode remains unchanged.

## Consequences

Ultra can increase calls/cost; it promises neither worker count nor model speed.
Fast, planning permissions, capacity and one-level delegation remain independent.
Unsupported explicit levels and unavailable bindings fail visibly rather than
silently downgrading. No new scheduler, adapter, worktree merger or MC endpoint.

Prompt-only changes were rejected: per-worker native levels, durable selection
and next-turn isolation require code as well as guidance.
