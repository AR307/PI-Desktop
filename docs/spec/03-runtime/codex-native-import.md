# Explicit Codex history import

PI imports selected local Codex conversations into independent native sessions.
This is a one-time, user-initiated read, not synchronization or an ACP session.
Project source files, credentials, permissions, running jobs and caches are not
copied. No model call is made to summarize the imported material.

## Entry points and local preferences

- A compact card below the Sidebar header and above pinned conversations opens
  the same wizard as Settings > Project archive > Import from Codex.
- Rendering the card does not scan Codex storage. The list scrolls independently.
- Closing the card opens a three-way confirmation. Cancel, Escape and backdrop
  dismissal keep it visible. Hide for this run is Main-owned memory and survives
  renderer reload/navigation, but not application restart. Do not show again is
  device-local renderer preference storage. Neither option cancels an import.
- The Settings switch restores the card and clears the current-run dismissal.
  Successful import does not change this preference.
- Search keywords include Codex, import and conversation history.

## Workflow

Opening the wizard scans CODEX_HOME, or the user's .codex directory when unset.
The source field accepts another directory or one JSONL file; the native picker
chooses a directory. Candidates are paged and searchable, include active and
archived conversations, and start unselected. Select a page, a project or
individual conversations. No fixed total-session truncation is permitted.

Source project identity owns the PI group mapping, never its display name.
Ordered roots, names and each conversation's actual working directory remain
distinct. Exact-path PI groups can be reused; conflicting roots require explicit
mapping. Root remapping preserves relative working-directory suffixes. Missing
roots can be rebound or explicitly left unbound. A conversation imported without
a directory is readable, but Host rejects continuation until the existing move
conversation workflow binds a valid directory. No scratch-directory substitution
is allowed. Source archive status is recorded in provenance and the wizard
applies PI's existing device-local archive preference to newly imported sessions.

The model defaults to PI's configured provider/model and can be changed with its
reasoning level. Codex model/reasoning values are provenance only. The run uses
normal PI tools, project instructions and approval settings.

Imports run sequentially with per-item results, progress, cancellation and
failure retry. Cancellation is identified by scan ID plus batch run ID; a late
cancel cannot stop a new retry or revive a cancelled batch. Completed sessions
remain imported. Existing import-codex-<source-id> sessions are skipped without
overwriting PI continuation. Closing the wizard releases its source catalog.

## Storage and recovery

Rust Host owns source SQLite/JSONL reads, conversion, attachment persistence,
project binding and native session/checkpoint writes. Main validates typed IPC
and forwards calls; Renderer owns interaction. No new database or schema is
introduced: project mappings use the existing KV store, and recovery uses the
native transcript compaction format. Other importers remain unchanged.

The reader supports standalone JSONL, active/archived rollouts, state_N.sqlite,
thread_history_N.sqlite and history_base chains with ordinal/byte boundaries.
Projected records and unprojected rollout tails retain source segment ordering.
Source databases are opened read-only; projected items and watermarks share a
read transaction. JSONL is read line by line, never head/tail sampled.

Visible history and effective model context are separate projections:

- Visible history retains messages, tool rows, reasoning summaries, errors,
  supported attachments and explicit warnings/raw evidence for unknown records.
- Effective context uses the latest surviving replacement_history and retained
  context, then valid suffix records. Rolled-back turns are excluded. Empty
  summaries with retained-only checkpoints are valid.
- Source system/developer text remains labelled historical reference only. It
  does not become active PI system instructions. Historical tool results become
  quoted material, not executable calls. Incomplete calls are aborted history.
- A stable import receipt anchors the native checkpoint even when the source
  ends with an image-only or incomplete row. New PI messages append normally.
- Unsupported/missing context requires an explicit history-only confirmation
  before persistence. Visible warnings are not represented as complete recovery.
- Local attachments are copied into PI's existing attachment store only from
  the selected source/project roots; remote downloads are not performed. Missing
  files, unsupported content and unavailable original file representations warn.

## Known boundaries

Codex's local storage is an evolving external format. Interleaved automatic turns,
future record kinds and unavailable fork segments are not proof of exact Codex
runtime equivalence. The importer marks detected incomplete input for explicit
history-only import. It does not resume live tasks, shells or delegated agents.
JSONL input is streamed, but a selected session's converted transcript, effective
context and attachment data are assembled in memory before native persistence;
multi-gigabyte single-session memory usage has not been load-tested.

Acceptance scenarios and actual evidence are tracked in the E2E plan and
docs/testing/codex-import-validation.md.
