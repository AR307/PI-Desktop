# Interrupted provider response recovery: validation record

Date: 2026-10-23

## Candidate and scope

- Branch: `codex/fix-interrupted-stream-recovery-20261023`
- Task candidate: `64ab7c86476261a1853a4873d79726ae2e62da9a`
- Runtime implementation: `2a6bc5df56b051e4f8dfacad2508e8bd8bc33a55`
- Base `origin/main`: `5f272b38bf540251263623f8b94818545d94f78b`
- Included released baseline: `v0.21.0-beta.5`,
  `3190f4167d4d93625d82491ca71874742610ddd4`
- Environment: Windows, Node 24.19.0, Electron 43.6.0; isolated profile,
  workspace, local HTTP/SSE provider, and real Host/Agent execution.

The task worktree reuses existing dependency links and the existing Host binary.
Shared/runtime outputs were built from the task worktree. Unchanged beta.5
Electron Main and renderer outputs were reused; Main loads this worktree's
runtime sidecar. The beta.5 label in screenshots is therefore expected and does
not indicate that the old runtime was tested. No dependency install or second
Rust build was needed.

## Old behavior and root cause

`providerHasContent` / delegate `meaningful` vetoed retries after any substantive
text or thinking arrived. A single reasoning fragment followed by a timeout or
`upstream_stream_read_error` stopped the turn on the first failed attempt, even
with infinite retry enabled. Provider-origin aborts could also be mistaken for
user cancellation. Delegates and one-shot completions lacked the main session's
stream-idle watchdog coverage.

Six regression scenarios failed on the old implementation: session/delegate
crossed with partial text disconnect, partial text timeout, and thinking
disconnect. Their real adapter/Agent path executes one tool, fails after partial
output, encounters another setup/stream failure, then recovers. The old code
stopped after two requests instead of reaching five.

## New behavior

- Main sessions, temporary side chats using the same runtime, and delegates
  automatically resume transient failures after partial output.
- Retain delivered fragments in separate completed rows and native replayable
  text/thinking plus completed tool results in context. Discard unfinished tool
  calls. Recovery itself does not replay completed actions.
- Add a model-only continuation when Pi cannot continue from an assistant tail;
  do not create a visible or persisted fake user submission.
- Apply stream-stall recovery to delegates and one-shot completions. One-shot
  calls retry their original context because no partial output or tool effects
  have been published.
- Distinguish provider aborts from caller cancellation. Stop still cancels the
  retry wait and returns the composer to idle without another model request.
- Preserve existing backoff, Retry-After, and finite/infinite settings. The
  finite budget remains ten retries per unsuccessful response; successful tool
  progress replenishes it, partial output does not. Infinite retry applies to
  sessions/delegates, not one-shot completions.
- Authentication, invalid parameters, local preparation, certificate failures,
  and explicit Stop remain terminal. Normally completed thinking-only responses
  and explicit output-token limits retain their existing Continue behavior.

No server, schema, permission, model-selection, or active-user-profile changes.
Retries may incur provider charges; this does not repair the upstream outage.

## Automated checks

| Check | Result |
| --- | --- |
| Targeted Vitest suites below | 13 suites, 601 tests passed |
| `tsc -b packages/agent-runtime` | Passed |
| Configured `biome lint` | Passed, 140 files |
| `git diff --check` | Passed |
| `node scripts/check-pr-base-main.mjs` | Passed; base main is an ancestor |
| `node --check scripts/e2e-provider-recovery.mjs` | Passed |

Vitest used `packages/agent-runtime/vitest.config.ts` and these files under
`packages/agent-runtime/src/`:

```text
runtime.test.ts                 subagent.test.ts
provider-recovery-flow.test.ts  native-response-recovery.test.ts
response-outcome.test.ts        provider-retry.test.ts
agent-errors.test.ts            one-shot-recovery.test.ts
provider-transport-recovery.test.ts
side-chat-context.test.ts       claude-cache-runtime.test.ts
google-adapter-fetch.test.ts    opencode-session-headers.test.ts
```

They exercise real provider adapters and Agent loops with replacements only at
external boundaries. Coverage includes partial text/thinking, stream stalls,
setup/stream shared budgets, recovery beyond the finite limit in infinite mode,
eleven successful tool rounds, unfinished arguments, caller cancellation,
permanent errors, native replay metadata, and reconstruction after recovery.

## Native Electron user journeys

Command: `node scripts/e2e-provider-recovery.mjs`, with `PI_E2E_ELECTRON` and
`PI_DESKTOP_HOST_BIN` referencing the existing local development binaries.

Final artifacts: `D:/PI-Desktop-worktrees/fix-interrupted-stream-recovery-20261023/.artifacts/issue-699/1792687644105/`

All eight scenarios passed, process exit code 0. `verified-summary.json` contains
the assertions; `results.json` contains fixture request counts, durable messages,
and lifecycle events.

| Scenario | Actual result |
| --- | --- |
| Completions setup disconnect | 3 requests, recovered automatically |
| Completions partial-text disconnect | 2 requests, original fragment retained |
| Responses setup disconnect | 3 requests, recovered automatically |
| Persistent setup failure | 11 requests, one exhausted-budget error; user Continue then succeeded |
| Repeated outages across tool progress | 24 requests, 11 actual successful Read calls, all tool results retained |
| Responses reasoning then `upstream_stream_read_error` | 2 requests, recovered automatically |
| Responses reasoning then `basispoint request timeout` | 2 requests, recovered automatically |
| Stop during partial-output retry wait | 1 request, one terminal lifecycle, normal `TURN_ABORTED`, idle editable composer |

Inspected unobscured screenshots:

- `06-responses-thinking-interrupt-retry.png`: retained thinking, retry countdown,
  available Stop control, no terminal error card.
- `07-responses-thinking-timeout-final.png`: completed answer, no timeout card.
- `08-stop-during-recovery-final.png`: retained fragment and idle composer.

Earlier acceptance exposed a missing terminal lifecycle when Stop cancelled a
retry after its partial row had been retained. A regression assertion first
failed with zero `agent_end` events; the fix now emits exactly one. Another
harness assertion incorrectly rejected the existing `TURN_ABORTED` cancellation
event. It was corrected to require that contract and reject provider error cards,
then the complete native suite was rerun successfully. Initial onboarding-overlay
screenshots are not used as final visual evidence.

## Limits and delivery state

- No live or paid provider API was called; production incident resolution is not
  claimed from controlled endpoint tests.
- No full monorepo suite, Rust rebuild, macOS/Android native test, or installer
  packaging was run; those surfaces were not changed.
- No `verify:ui:*` command, active user instance, or user data cleanup was used.
- Documentation-only changes after the candidate do not change tested executable
  behavior.
- Local commits only. Nothing pushed, merged, or released. An installed beta.5
  does not acquire this fix until a later build is delivered.
