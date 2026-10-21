# ADR turn-process-and-thinking-display: Turn process and thinking presentation

- Status: Accepted
- Date: 2026-09-17
- Amended: 2026-10-21
- Issues: #510, #461
- Amends: D071, [ADR 0242](0242-delta-only-streaming-updates.md)

## Context

A model can alternate reasoning, tool calls and progress text many times before
answering one user request. Separate activity groups leave those progress
messages at the same visual level as the answer, while one flat process
container still leaves long tool/search sequences difficult to scan. Some
readers also need a thinking indicator without rapidly changing reasoning text.

## Decision

One unified turn-process presentation applies to every loaded assistant-turn
entry: it projects the entry into one collapsible process disclosure plus its
trailing answer. Thinking, tools, intermediate assistant text and the turn's
`Bash` run rows keep their original order inside that disclosure. A trailing
assistant text stays visible
while streaming; if later tool or thinking activity follows, that text moves into
the process without changing the stored message. There is no semantic
final-answer marker in `UiMessage`, so the renderer does not guess intent from
wording. User/system messages and compaction dividers retain their existing turn
boundaries.

One turn renders exactly one process disclosure. Every row the turn produced
before its answer lives inside it — the activity groups and the `Bash` run rows
alike — so a long turn collapses in one gesture instead of leaving a column of
sibling disclosures above the answer. The answer itself stays outside it. An
untouched process closes when the turn completes, so only the final answer
remains; when the turn produced no final text, the process header and its error
or pending-action surfaces remain visible.

Inside that disclosure, the display mode decides how activity is grouped.
`AppSettings.transcriptDisplayMode` is one of `flat`, `command-first`, or
`fully-folded`; an absent or unknown value resolves to `fully-folded`, the
layout released in v0.20.0. Every mode renders exactly one outer disclosure.

- In `fully-folded`, contiguous activity forms ordinary activity groups: one
  contiguous tool/search/thinking/Bash segment between ordinary assistant
  progress paragraphs. A `Bash`/run row stays inside the group around it, so a
  command reads as another line of that group. Existing Task topology remains
  its segment's container and is not duplicated inside an ordinary activity
  group.
- In `command-first`, ordinary activity groups still render, but every
  `Bash`/run alias is lifted out as a standalone row beside them: adjacent calls
  stay separate and a row's detail stays closed until the user opens it. A
  normal assistant progress message and a command both end the current group.
- In `flat`, no nested activity groups render at all. The outer disclosure lists
  active tools, commands, thinking and progress rows in transcript order, with
  tool details collapsed.

In `command-first` and `fully-folded`, a group appears only when at least two
items are visible under the current thinking preference. A singleton uses its
item disclosure directly, and hidden thinking does not create a redundant
wrapper.

`keepCommandsExpanded` is deprecated. It is retained only so persisted settings
still load, is no longer exposed in Settings, and is not read for rendering; new
writes store `transcriptDisplayMode`.

Group folding defaults are unified across modes and do not depend on the
thinking preference. Where a group renders, the group that owns the active
execution segment starts open, then closes on completion only while untouched.
Other completed groups start closed. An untouched active group containing any
recorded failed or denied tool stays open through later recovery and closes on
turn completion if still untouched.

The turn's disclosure header states the turn's outcome and never echoes the item
it is working on, because a shell command or search query can be arbitrarily
long. It reads `failed`, `stopped`, `running`, or finished, in that precedence:
a recorded failure outranks a stop, because the turn produced no answer and a
normal-looking header hid that. A stop is read from an aborted message, the only
signal the runtime records — the turn result distinguishes completed from failed
only. Aborted activity rows also record a stop while a tool or reasoning step is
in flight; delegated child rows do not determine the parent turn's outcome.
While running, stages a reader can sit in front of (compaction, recovery)
name themselves; a live reasoning step reads `Thinking`, and momentary stages
read as plain running. Durations are dropped when the transcript recorded no
timing rather than shown as zero, and issue counts sit beside the label.

The disclosure and the levels it reveals share one left edge. Hierarchy is
carried by type size and colour, not by indentation, so a nested group header and
a run row start exactly where the turn header does.

The thinking preference is a boolean `showThinking`. With it on, `flat` and
`command-first` expand every Thinking row by default and let the user collapse
them; an expanded row shows the full reasoning markdown, while a collapsed row
shows only the Thinking indicator with no summary or excerpt. `fully-folded`
keeps the released exception: earlier Thinking rows stay collapsed, and the last
active Thinking row opens only while it is the live step, so completed rows
collapse. With the preference off, no completed reasoning row renders; only a
live whole-run `TextShimmer` `Thinking` indicator remains while reasoning is
actively streaming. The shimmer is a 1.2s linear sweep with a 220ms fade — no
spinner, pulsing dot, or per-character animation — and stays static under
reduced motion. The stored reasoning is retained, so turning the preference back
on restores the rows. Hidden thinking never creates an empty group wrapper.

The leaf default that an earlier decision first introduced was later removed.
Except for the display-mode Thinking defaults above, item payloads never open
themselves: a tool-call, hosted-search or plan row stays a header row until the
user opens it, wherever it sits in the group, and this holds regardless of the
thinking preference. Group defaults are unchanged, and opening a closed ancestor
still exposes the retained item choices without opening all descendants.

Each header toggles only its own level. Parent and child states are independent:
closing a parent preserves descendant choices, reopening restores them, and
sibling groups do not form an accordion. Manual interaction with an item claims
its containing group as user-owned without toggling it; completion must not close
a container around content the user opened, focused, or selected. Manual choices
survive streaming, completion, preference changes, reparenting from singleton to
group, and row remounts while the owning retained session pane remains alive.
Pane eviction, session deletion, or renderer restart releases this presentation
memory; it is not stored in messages or host settings.

Search/navigation reveals the ancestor path its target needs: the turn process
and, where one exists, the activity group that own the named message. Item-level
targeting is not part of this change, so each row's own details stay behind its
own disclosure.
Replaying the same request does not repeatedly override a later manual close.
Reasoning hidden by the preference stays hidden until the user turns
`showThinking` on. Assistant errors, stopped trailing partial answers,
permission/question/plan/goal decisions, and any other pending action surface
remain outside hidden process content and reachable without expanding it.

Settings → AI → Defaults exposes a `Show thinking` boolean that persists as the
optional `showThinking` `AppSettings` field, and a `Transcript display`
segmented control with the labels `Flat`, `Commands first`, and `Fully folded`
that persists the optional `transcriptDisplayMode` field. Absent and invalid
`transcriptDisplayMode` values resolve to `fully-folded` in both the renderer and
main-process settings normalizers. Absent and non-boolean values for
`showThinking` fall back to the legacy `thinkingDisplayMode` field: an explicit
`compact` hides reasoning while `detailed`, an unknown value, or an absent field
shows it. The legacy `thinkingDisplayMode` and deprecated
`keepCommandsExpanded` fields are retained for persisted-settings compatibility
and are no longer exposed in the UI. `keepCommandsExpanded` is also no longer
read for rendering. These preferences change presentation only; they do not
alter provider thinking levels, runtime/model context, stored reasoning, export,
permissions, execution, or copy payloads, and the thinking preference does not
control turn-process or activity-group folding. Process headers use recorded
timing, direct tool/search counts, running state, and issue counts; they do not
double-count delegated child work or treat a failed child as a failed assistant
turn.

## Consequences

- One disclosure per turn keeps the final answer and actionable interruptions
  reachable, and makes a long turn collapsible in a single gesture.
- Group folding defaults are unified across display modes: active work stays
  visible, untouched completed groups fold by default, and explicit disclosure
  choices are preserved regardless of the thinking preference. Closing the
  turn's disclosure closes the groups under it, and reopening restores the groups
  the user had opened.
- With `showThinking` off, no completed reasoning row renders; only the live
  whole-run TextShimmer `Thinking` indicator remains while reasoning streams.
  Stored reasoning is retained and reappears when the preference is turned back
  on.
- `transcriptDisplayMode` keeps the three layouts available and defaults to the
  released `fully-folded` layout. `flat` removes nested groups, `command-first`
  lifts commands to standalone rows, and `fully-folded` keeps commands in their
  groups; all three render exactly one disclosure, and reading the mode while
  rendering repaints the transcript immediately instead of waiting for new
  messages.
- With `showThinking` on, Thinking rows default expanded in `flat` and
  `command-first`; `fully-folded` keeps the live-only auto-open exception.
- The header answers "how did this turn end up" in one short line. Echoing the
  current command was removed: it pushed the counts off the row and duplicated
  what opening the item already shows.
- Disclosure memory is pane-owned presentation state with stable turn, group,
  and item identities; it is neither a persisted transcript contract nor a
  central workflow-store concern.
- This groups loaded transcript entries only; it does not reconstruct unloaded
  history or join turns across compaction boundaries.

## Validation

For the 2026-09-20 amendment, the request explicitly limits validation to static
checks and compilation. The linked E2E scenarios describe intended behavior for
source and design review; no unit, component, integration, browser, Electron, or
E2E tests are added or run for this amendment. See
E2E-CHAT-turn-process-and-thinking-display for the synchronized scenario text.
For the 2026-09-27 amendment, `apps/desktop/test/turn-process.test.mjs` covers
the default selection, and `pnpm test:e2e:transcript-disclosure` exercises
active-to-completed collapse and user-open retention in real Chromium.
For the 2026-10-16 amendment, `apps/desktop/test/thinking-visibility.test.mjs`
covers the `showThinking`/legacy `thinkingDisplayMode` resolver precedence, and
the i18n catalog tests cover the new `settings.showThinking` copy. The UI,
resolver, and E2E scenarios are validated on the integration candidate; see
E2E-CHAT-turn-process-and-thinking-display for the synchronized scenario text.
For the 2026-10-21 amendment, `apps/desktop/test/turn-process.test.mjs` covers
mode segmentation, including `flat`, `command-first` and `fully-folded`, and
header phase precedence. `apps/desktop/test/transcript-display-modes-ui.test.mjs`
covers the renderer wiring for distinct mode segmentation, Thinking-row defaults
and the whole-run `TextShimmer` used for a collapsed or hidden Thinking
indicator.
`apps/desktop/test/transcript-display-mode-settings.test.mjs` covers the
Settings row label and search indexing, and
`apps/desktop/test/settings-roundtrip.test.mjs` covers normalization, write
validation and the `fully-folded` default. See
E2E-CHAT-turn-process-and-thinking-display for the synchronized scenario text.
