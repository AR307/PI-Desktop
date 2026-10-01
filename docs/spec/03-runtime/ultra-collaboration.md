# Ultra collaboration

Ultra is a session execution preference, never a provider reasoning enum. The
desktop reasoning slider adds a final Ultra stop; the mobile model sheet exposes
the same choice. Rust persists it in the existing session settings namespace.
New sessions start off. The saved ordinary reasoning level remains intact.
Changing provider/model or MC group resets Ultra unless the same submission
explicitly enables it again. Fast is independent.

## Execution

- Resolve each model's highest explicitly supported native reasoning at launch.
  Models without declared reasoning receive no invented level.
- User and approved-plan launches can opt in. Auxiliary calls and image
  generation do not inherit proactive delegation. Plan/Goal planning keeps its
  existing execution restrictions while allowing highest parent reasoning.
- Reuse Task/TaskWait/TaskList/TaskStop and existing concurrency. Split substantial
  independent work, give workers non-overlapping responsibilities, and let the
  primary agent own integration, validation and user questions. No worker quota,
  recursive delegation, automatic model changes or additional scheduler.
- Running configuration edits affect the next turn only. Rebinding an idle
  parent preserves workers' captured model, group, native level and Fast.
- New workers default to the parent binding; explicit model overrides still
  require the existing subagent authorization. User-pinned definitions retain
  their model choice. Builtin reasoning defaults do not cap Ultra.
- Optional Task.thinkingLevel and user definition levels are explicit native
  choices. Unsupported levels fail before requesting a model. Resume omission
  keeps the child's last accepted level and exact authorized binding.

## Dispatch and asynchronous handoff

Ultra ends the parent turn normally after a successful Task batch. All calls in
that batch start and their tool results enter history before pi's native
finishTurn boundary returns end. The composer becomes usable while worker cards
remain running. No further parent provider request or TaskWait polling is needed
to keep the workers alive. Ordinary mode retains its existing continuation rule.

Reports silently wake integration through the existing host queue. Even workers
that settle before Task returns use that queue after the parent end events,
not an extra hidden continuation of the dispatch turn. Multiple ready reports
share a wake; reports arriving later use the existing boundary/wake delivery.
The parent may integrate completed reports while others still run, then end its
turn again until another completion. This does not require all workers to finish
at once and does not prevent a new user prompt while they run. An explicit user
message admitted at the boundary still receives its normal steering continuation;
the handoff must not retain it without answering until a worker finishes.

An entirely rejected dispatch does not claim a successful handoff: the parent
can explain the errors, without silently replacing the requested model or doing
its assigned work. Error, truncated-response and user-stop semantics are
unchanged. Parent Stop and explicit worker cancellation remain independent.

## Persistence and interface

The `ultra` boolean travels through session configuration and current/next/chat
snapshots, separately from SessionThinkingLevel. Task summaries persist actual
model key, group, native reasoning, Fast and completion. Settling a Task updates
its original row without another tool call, usage entry, or history position;
replaying its initial snapshot cannot revive a completed worker. Both clients
display accepted child configuration. Unavailable tools/definitions are reported
before launch, not represented as successful collaboration.

MC only relays the existing configuration frames. No server API or database
table is added. Controlled Electron/mobile acceptance proves request wiring,
concurrency, current/next isolation and durable resume; it does not prove how a
real model autonomously decomposes work. Paid/live-model evaluation is separate.

## Selected-tier summary

Desktop and mobile show the Ultra summary only while Ultra is selected.
The summary uses the selected model binding's highest declared native tier,
followed by Workflow + Subagent (for example, Max + Workflow + Subagent or
Xhigh + Workflow + Subagent). It is not inferred from a model-family name.
Models without native reasoning display Workflow + Subagent without inventing
a tier. Leaving Ultra or changing models hides the summary. This replaces the
previous always-visible cost/delegation hint and does not change execution.

## Delegation control and model identity

Subagent reports are internal notifications, not synthetic user messages.
The parent can consume them silently. Genuine assistant answers and worker
cards remain visible. Parent Stop does not stop detached workers or change
their cards to stopped. Desktop cards provide individual cancellation and
the Subagent header provides stop-all; both wait for actual worker settlement.

Task.model selects an exact provider ID/model ID pair. Each enabled MC group
with text permission is separately advertised for an opted-in account model;
ordinary providers with identical model IDs likewise remain distinct. An
ambiguous alias returns available exact choices rather than choosing a group.
Task startup reports the actual model, provider/channel, group and reasoning.
Explicit model choices and resumes do not use definition fallback models.
Resume retains the original worker transcript and exact authorized binding;
an unavailable channel reports its error instead of inheriting the parent.
An explicit delegation failure is not permission to substitute another model
or take over the delegated work without the user's agreement.
