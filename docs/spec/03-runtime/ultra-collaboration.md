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
