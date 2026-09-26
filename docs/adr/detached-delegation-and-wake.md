# ADR: Detached Delegation and Idle Wake

- Status: Accepted for implementation
- Date: 2026-09-26
- Deciders: PI-Desktop core
- Related: D628, D328, D352, D386, ADR 0089, ADR 0213, ADR 0253, ADR 0279,
  E2E-SUBAGENT-detached-wake

## Context

ADR 0089 made delegation non-blocking inside a turn, but the turn itself
remained the delegate's cage. When the parent stopped calling tools while
delegates ran, the runtime swallowed `turn_end` / `agent_end`, kept the durable
turn open, waited for every delegate, and re-prompted the parent with their
reports (D328). `getStatus().isRunning` counted running delegates, so the
session read busy for the delegation's whole life. Three paths killed
delegates outright: user Stop, `dispose()`, and a terminal parent error
(D352); a new prompt additionally aborted delegates left over from earlier
turns. `RESUMABLE_STATUSES` admitted only `completed`, `failed`, and
`timed_out`, so an interrupted run — stopped, aborted, or killed by an app
restart — could never continue through `Task.resume`.

The practical costs:

- A session with one slow delegate was unusable: the user could not send the
  next prompt, queue work, or even Stop without destroying the delegate.
- Stop conflated "end this turn" with "destroy the background work", which is
  rarely what the user meant and was irreversible because interrupted runs
  were not resumable.
- The open-turn wait was an unbounded busy state with no user-visible work,
  indistinguishable from a hang in the sidebar and on mobile.

ADR 0089 had already named the alternative and deferred it: "Background tasks
across turns (Proma-style) … requires reworking the turn lifecycle, completion
semantics and the renderer's session-idle handling." The pieces that made that
rework expensive have since shipped: the host-owned durable turn queue that
starts a queued turn the moment the session goes idle (ADR 0213, D386), and
transcript-backed resumable chains (ADR 0279).

## Decision

### 1. Delegates detach from the turn (amends D328)

When the parent stops calling tools while delegates run, the turn ends
normally: `turn_end` / `agent_end` are emitted and the session goes idle.
`getStatus().isRunning` no longer counts running delegates; the optional,
additive `AgentStatus.backgroundDelegations` count carries them. The turn is
held open only to inject reports that already settled during the turn and were
never read through `TaskWait` — a bounded continuation with a single delivery
shot per record under `MAX_TASKWAIT_RESULT_CHARS`, not an open-ended wait.
Turn epochs no longer gate delivery: a report that settled during an earlier
turn is delivered at the next turn boundary. New prompts adopt running
delegates instead of aborting them, and `MAX_SUBAGENT_CONCURRENCY` counts
every running delegate. `TaskWait` keeps its blocking-convergence semantics
unchanged.

### 2. Settlement wakes the idle session (uses D386)

A delegate that settles while the session is idle queues one wake turn through
the existing host-owned queue (`session.queuePush`). The queued content is the
stable marker line `Subagent reports ready:` plus the settled delegation ids;
report bodies never enter the queue. One queued wake serves every settlement
until a turn consumes it, and the push is idempotent on the settled ids. The
runtime recognizes a wake turn at prompt preflight by the exact marker prefix
— never by loose matching over arbitrary user text — and expands the prompt
with every undelivered report plus a heartbeat for still-running delegates,
before the compaction preflight measures the context. Reports are marked
delivered only after the preflight passes, so a compaction or context-budget
failure leaves them claimable by the next wake. Stopped and aborted runs are
never auto-delivered; their chains stay resumable instead. Both the desktop
sidecar and the headless `pi-host` already route `session.queuePush`, so no
new transport is introduced.

### 3. Stop stops the turn, not the delegates (amends D352)

User Stop (`abort()`) and a terminal parent error end only the parent turn.
Delegates keep running in the background; `TaskStop` and the Task card remain
the explicit way to cancel one. Only `dispose()` still aborts delegates —
process exit cannot be survived — and a dispose-aborted run settles as
`aborted`. D352's original motive (a fatal parent error must not leave the
session stuck busy) is preserved by decision 1: the session reads idle because
`isRunning` no longer counts delegates, so Continue is admitted without
killing anything.

### 4. Every settled status is resumable (amends ADR 0279's status gate)

`RESUMABLE_STATUSES` grows from `{completed, failed, timed_out}` to also admit
`stopped`, `aborted`, and the restart-rebuilt `interrupted`. Resume replays
the chain's persisted transcript, which exists for interrupted runs exactly as
it does for completed ones; refusing them protected nothing. `TaskList` marks
stopped and aborted records `(resumable)`. All other resume gates — same
session, agent match, read budget, one live run per chain — are unchanged.

### 5. Presentation

The renderer keeps a per-session background-delegation count fed by the
runtime's `status` events (which now also fire on delegation start and
settlement). An idle session shows it as a sidebar status dot and an
idle-session chip above the docked composer ("N subagents running in
background", localized in every shipped catalog). A running turn shows
nothing new — the turn's own activity indicator already explains it. The IPC
contract is untouched: `backgroundDelegations` is an optional field on the
existing `AgentStatus` payload, and mobile projections pass it through
transparently.

### Boundary: no restart survival

Delegates execute inside the sidecar process. They do not survive an app
restart; a run the app closed while it worked rebuilds from the transcript as
an `interrupted`, resumable chain, and the wake applies only while the app
runs. A durable wake marker left in the host queue across a restart drains
into a turn that reports nothing pending and offers the resumable list — it
does not auto-restart delegates.

## Consequences

- A session is usable while delegates work: prompts, queueing, Stop, and
  Continue all behave as on an idle session, and background work is visible
  instead of masquerading as a busy turn.
- Stop becomes safe. Nothing background is destroyed implicitly, and anything
  interrupted — by Stop before this change's semantics, by dispose, or by a
  crash — can continue through `Task.resume` instead of restarting cold.
- Reports cannot be lost between turns: settled-in-turn reports leave at the
  boundary, idle settlements wake the session, busy settlements ride the
  current turn's boundary, and a preflight failure leaves the shot unspent.
  The retention cap prunes undelivered reports last.
- Subagent usage that settles between turns is attributed to the next
  `turn_end` (usually the wake turn) instead of being dropped with the
  delegates that used to die with their turn.
- A rare benign race remains: if the user prompts between an idle settlement
  and the queued wake draining, the user turn delivers the reports and the
  wake turn arrives empty, saying so briefly. Removing the queued wake item by
  hand suppresses further wakes until any next turn resets the guard.

## Alternatives considered

- **Keep the open-turn wait and only add resumability.** Rejected: the busy
  session and Stop-destroys-work problems are lifecycle problems; resumability
  alone turns data loss into re-work but leaves the session unusable while
  delegates run.
- **Push reports into the queue content.** Rejected: queue rows are persisted,
  listed, and editable user-visible text; a 50k-character report does not
  belong there, and the single-shot `reportDelivered` bookkeeping already
  lives next to the records the preflight reads.
- **A dedicated wake RPC / event instead of a queued marker turn.** Rejected:
  the host queue already owns exactly this behavior — durable, idempotent,
  starts the turn the moment the session is idle, defers while busy (D386) —
  and a marker turn is visible and debuggable where a hidden RPC is not.
- **Detect the wake by matching report-like text.** Rejected outright: user
  text must never be able to impersonate runtime control flow; the marker is
  a stable prefix constant checked with `startsWith`.
