# ADR: Native MC Claude routing and non-destructive response recovery

- Status: Accepted
- Date: 2026-09-29

## Context

The former recovery policy treated a completed thinking-only response as empty,
removed the assistant suffix and resubmitted the request. It also replayed
partially delivered streams. These behaviors could discard useful work and
charge for duplicate generation without explaining the provider's termination.
Legacy MC catalogs could route Claude through a lossy OpenAI conversion first.

## Decision

MC-authorized chat model IDs containing "claude", case-insensitively, use pi's
Anthropic Messages adapter. Catalog compilation, task binding and relay path
validation share one policy. Original model IDs, group permission checks,
reasoning capability configuration and account credential isolation remain.
Other sources and images keep their existing routing. A rejected Messages
request is not retried with another protocol, group or model.

Response outcome belongs to the agent runtime, not Electron or the UI. A small
classifier considers cancellation, transport/protocol failure and explicit
output-length termination before content. A completed, truly empty response
may retry once per submission. Text, thinking, redacted native thinking and
tool activity prevent automatic replay, even with infinite provider retry.
Pre-content temporary failures keep the existing budgets and Retry-After.
Valid tool rounds and internal completion notices keep their existing semantics.

The user may explicitly continue a partial response by appending a new user
turn. Valid text and native thinking signatures survive the existing message
meta store and pass through pi's history converter. Unsigned partial thinking
remains visible but is not fabricated into native replay. Incomplete tool
arguments never execute. This does not promise recovery of internal reasoning
state that the provider did not return.

Only whitelisted final-wire parameters and response counters enter diagnostics.
Missing provider data remains missing. Prompts, response bodies, credentials and
authentication headers are not logged. No new database table or MC server
interface is needed.

## Alternatives and consequences

Fixed thinking budgets, forced reasoning downgrades, extra timeouts and more
retries do not establish why a provider stopped; they were rejected. A custom
SSE translator would duplicate pi and was also rejected. Users now explicitly
continue interrupted work; they no longer receive an invisible automatic
replacement. Persisting minimal native blocks adds metadata to existing rows.

This decision supersedes the post-content replay and thinking-only retry
portions of ADR 0050, ADR 0128 and runtime spec section 5e. It does not disable
ordinary tool continuations or the existing approved Plan/Goal progress step.

## Verification

Native adapter tests cover max effort, signed/unsigned thinking, missing
message_stop, max_tokens, incomplete tools, restart and completed tool context.
The controlled Electron/mobile acceptance uses local MC authorization and relay,
real pi and Rust persistence. Production MC/Kiro acceptance is separate and
requires explicit authorization; local passing tests cannot prove an upstream
production incident resolved.
