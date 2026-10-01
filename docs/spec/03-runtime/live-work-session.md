# Live Voice Work Session Integration

> Status: In progress; acceptance requires the automated and manual evidence
> listed in the delivery plan. Live Voice provider bindings and work-session
> bindings are separate scopes.

## Purpose

Live Voice may submit a bounded work request to the existing local PI-Desktop
Agent session selected by the user. The Live provider remains a voice interface;
the existing Agent Runtime continues to own file, shell, MCP, plugin, skill, and
subagent work under the session's current model and permission policy.

## Scope and authorization

- A call without a `workTarget` remains a voice-only call.
- Enabling work access is an explicit renderer action, independent of opening
  or expanding the preparation surface. A collapsed **Connect a work session**
  section starts with **Allow work requests** unchecked. Start includes a
  `workTarget` only after that opt-in and a valid local-session selection; an
  expanded section, an existing session, or context consent alone never grants
  work access. Main resolves the selected local session and creates a
  call-scoped `LiveWorkBinding`; a provider tool request cannot choose a
  session, project path, model, mode, or permission.
- A call's work binding does not follow sidebar selection. Opening another
  session is navigation only; changing the work target requires a new call.
- The first implementation accepts local desktop sessions. Native Pi and
  remote work sessions stay unavailable until their Host surfaces implement the
  same scoped controls and terminal events.
- Context sharing is a separate, unchecked-by-default, next-call work option.
  Closing or reopening preparation, changing or creating the target session,
  disabling work access, and finishing or canceling the call reset consent.
  When disabled, the intent classifier receives the current request and bounded
  work-state metadata but does not read prior session messages. No work or
  context opt-in is persisted by this interaction.

## Candidate and routing flow

Each provider exposes only `delegate_to_work_session({ instruction })`. Main
validates the tool name and arguments, freezes the call scope, registers a
bounded operation identity, and returns a short `received / not_started`
receipt before intent classification or Agent admission. Identical provider
request IDs are not dispatched twice; changed content under the same ID is
rejected. WebSocket receipts and work feedback are reported as locally sent
only after the socket write callback succeeds. Close, cancellation, send error,
or a one-second write deadline reports undelivered; an undelivered initial
receipt prevents classification and Host admission. This is not evidence that
the remote provider processed the message or that a person heard it.

A read-only one-shot classifier uses the selected work session's configured
model with tools disabled. Its strict output is passed to deterministic
routing. Conversation and status requests do not create turns. A clear
constraint on the observed active turn may steer that exact turn. An explicit
independent task uses the Host-owned queue. Ambiguous routing, stale turns, and
unavailable sessions fail closed; steer failure never falls back to prompt or
queue. A result query reads the latest terminal operation recorded for the
current call, or the explicitly referenced operation, and shows its bounded
summary without starting another turn.

### Reliability and admission identity

Main captures the active turn synchronously when it registers a provider
candidate. An explicit `null` remains “no observed turn”; stop and steer never
retarget a later turn. Duplicate provider request IDs reuse their original
operation and observation. A validated stop runs on the reserved control
classifier lane and advances a barrier: earlier writes that have not crossed
Host admission are withdrawn, while a write already dispatching remains
unknown until read-only Host evidence resolves it.

Ordinary new work uses reject-if-busy admission. Only an explicit queue intent
or a classifier-confirmed independent task enters the Host queue. AgentHost
rechecks Main's private workspace identity against fresh session metadata at
the final turn/queue admission boundary. A mismatch returns `WORKSPACE_CHANGED`
before a prompt or queue entry is created. An idle explicit enqueue asks
AgentHost to drain its existing queue; restored held entries remain held.

Classifier calls have an 8-second deadline and receive cancellation; snapshot
reads and individual Host dispatch waits are bounded. If a Host write has
already been issued and its result is not known, the operation becomes
`unknown`, is checked only through an exact read-only identity lookup, and is
never resubmitted. Closing the call withdraws pre-dispatch candidates but keeps
an in-flight admission `unknown`; accepted work remains Host-owned. The UI
distinguishes classifier-invalid, classifier-timeout, caller-withdrawn,
receipt-undelivered, scope-changed, Host-rejected, and dispatch-unknown states.

Admission summaries and terminal results are separate. A matching terminal
event can settle unknown admission and cannot be downgraded by a late ACK.
Task results are associated only with write operations on the exact turn; a
stop operation retains its control acknowledgement and stores the stopped
turn as a separate `targetTurnId`; the stop row does not become a task
execution/result row. An explicit result query through that control operation
resolves to the linked write operation when it exists. The Main result reader
retries bounded history reads for the exact terminal turn and ignores
child/tool messages. It marks the result unavailable when no eligible root
assistant result can be read.

Project and session lookup uses Host metadata and returns at most 20 labeled
choices with opaque, call- and binding-revision-scoped `selectionRef` values.
References expire after 60 seconds and do not expose project paths or session
IDs. Opening a uniquely labeled session navigates through the existing
renderer; duplicate labels require an explicit panel choice. Session creation
is available only for a listed registered project and requires the user's
panel action. Neither opening nor creating a session changes the active work
binding.

## Existing Host and Agent ownership

Work submission uses the existing AgentHost and registered Agent handlers. The
Host queue remains the only queue and applies its existing capacity, order,
delivery, and cancellation behavior. Voice user messages carry an optional
`voiceOrigin` containing the call and operation IDs. Existing messages without
that metadata remain valid.

Stop and abort requests include the observed turn ID and are checked at the
actual run owner. Ending a Live call closes its candidate scope and media but
does not cancel work already accepted by the Agent or Host queue. Permission,
Plan, Goal, and AskTool decisions stay in their existing UI and policy paths.

Only the Host's authoritative turn-terminal event settles the Live operation.
Message completion, tool output, or a provider response ending is not proof
that the work finished. Missing evidence remains unknown; completion alone
does not imply tests passed.

## UI and current capability boundary

Idle Composer uses the single Live Voice entry and its side-effect-free
preparation surface; there is no second Live Work icon. A missing or ineligible
target explains how to choose or create a local work session. The same explicit
Start action starts a muted voice-only or opted-in work call. Opening the work
section does not start a call, create a session, read conversation context, or
authorize work.

Call Details, opened deliberately from the global compact bar, displays the
fixed work target, whether bounded context sharing is enabled, current operation
admission/execution state, feedback delivery status, bounded route or rejection
messages, exact terminal summaries, and short-lived project/session choices.
It provides actions to view the bound session, open a listed session, create a
session in a listed project, stop its observed running turn, or cancel its exact
queued item. Creating a session uses the existing defaults and leaves the
current Live binding alone. Closing Details, pressing outside it, or pressing
Escape changes neither the call nor accepted work. Navigating to another page
or session does not hide the global bar or retarget the work binding.

The compact bar owns Cancel during startup and End/mute during the call;
Ending remains visible through both Main and renderer cleanup even after the
feature is disabled. End remains distinct from stopping an observed task or
canceling an exact queue item. This presentation redesign changes no IPC,
persistence, Host admission, permission, or context-projection contract.

### Work feedback and announcement policy

Host feedback is queued separately from work execution, bounded to eight
items, deduplicated, and coalesced on overflow. Received receipts stay
context-only. Automatic status and result speech waits for provider generation
to finish, user speech to stop, and local playback to be idle; it then applies
a 700 ms quiet window and a three-second minimum speech gap. Feedback older
than 15 seconds remains visible and is delivered as context-only. Silent mode
suppresses automatic speech without stopping work; an explicit status or
result query may still be spoken. Feedback delivery failure is shown
separately and never repeats the work request.

Gemini Live and Realtime use PCM output-credit drain as the local playback
queue signal. Codex work calls route the remote audio element through a local
Web Audio analyser and observe its output samples; if that monitor cannot be
established or its AudioContext is not running, automatic feedback remains
held. This observes renderer audio activity before the output device, not
whether a person heard it. The full provider and device behavior still
requires the manual matrix in the delivery plan.

## Privacy and resource limits

- No provider-supplied path, session identity, raw IPC operation, permission
  flag, or arbitrary tool schema crosses the work boundary.
- Context projection includes only bounded plain user/assistant text after
  filtering tool output, attachments, and prior voice-origin messages.
- Live captions are transient and are not inserted as work-session messages.
- Call cancellation controls only unaccepted candidates and Live feedback; it
  is not an Agent cancellation signal.
- Per-call candidate identities and operation views are bounded and discarded
  when the call closes. Existing Host persistence owns accepted queue entries
  and user-message provenance.

## Validation references

The implementation and test evidence are tracked in
[`../../implementation/live-work-evidence.md`](../../implementation/live-work-evidence.md).
The representative user path and automated coverage status are listed in
[`../06-delivery/04-e2e-test-plan.md`](../06-delivery/04-e2e-test-plan.md).
