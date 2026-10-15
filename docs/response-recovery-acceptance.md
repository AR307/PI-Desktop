# MC Claude and response recovery acceptance

Date: 2026-09-29. Scope: PI clients only; no MC service changes, production
credentials, paid model requests, push or release publication.

## Candidate and scope

- Worktree: `C:/Users/x1836/.codex/worktrees/mc-claude-recovery/piformc`.
- Branch: `codex/mc-claude-recovery`.
- Development baseline: `3d96703fcfe3da23a1dda59e88077c199b168c2a`, retaining the
  committed MC/mobile features required by `DEV-BASELINE.md`.
- Fetched remote main: `920b12b8e053165d343a421b3cb8ee93c50a436a`; confirmed an
  ancestor of the task branch. No edits to the primary or other dirty checkouts.
- Routing implementation: `7bc83231b`. Recovery implementation: `334e9cff4`.
- Final application candidate: `3ce6ecdfd92c429b6779de745fbefbd2d526b99a`.
  Intervening commits adjust only acceptance synchronization and screenshots.

Only original MC chat IDs containing `claude` select Messages. Other sources,
other MC chat models and image routes retain their existing selection. Native
capabilities reuse the catalog resolver, including published dotted aliases;
max effort is not downgraded or replaced with a hardcoded thinking budget.

All-source recovery distinguishes empty, thinking-only, explicit truncation,
interruption and cancellation. Empty retries once per submission. Substantive
output prevents replay. Continue appends a user message, retains prior content
and valid native metadata, and never executes incomplete tool parameters.

## Controlled user flows

### Native Messages, desktop and mobile

Command: `node apps/desktop/test/e2e/mobile/response-recovery.mjs`.
Result: exit 0, 20 checks passed against the final application candidate.
Artifacts: `.artifacts/response-recovery-1790666817334/`.
Log: `.artifacts/candidate-native-mobile-e2e-final.log`.

Real Electron, Node/pi runtime, Rust persistence, local MC HTTP/WSS fixture and
390 x 844 mobile Chromium were used. Verified:

- MC browser authorization and pairing; original Claude alias advertised as
  OpenAI actually reaches `/v1/messages` with the selected encoded Chinese
  group, MC Bearer and no upstream SDK API-key header.
- Final request contains adaptive thinking and `output_config.effort=max`,
  without a fixed budget. Diagnostics retain upstream path/group.
- Thinking-only, explicit max_tokens and missing message_stop retain content
  and do not replay. Wholly empty responses make exactly two requests.
- Desktop restart, mobile reconnect and explicit Continue preserve native
  thinking metadata and append history. An unsent phone draft is preserved.
- Desktop Continue synchronizes to the phone. Stop remains aborted and sends
  no recovery request.
- English/dark and Chinese/light screenshots, thought disclosure, phone width
  and actionable Continue controls. Screenshots were visually reviewed.

An initial acceptance assertion raced an idle snapshot ahead of its new relay
message. The persisted response was correct; the harness now awaits the new
terminal message ID. Visual review also found a primary/secondary hover-style
collision, fixed using the existing primary Button variant and reverified.

### Ordinary providers

Command: `node scripts/e2e-provider-recovery.mjs`.
Result: exit 0, five behavior scenarios passed.
Artifacts: `.artifacts/issue-699/1790665997374/`.
Log: `.artifacts/candidate-provider-e2e-2.log`.

This run used application implementation `334e9cff4` and harness revision
`0686dc012`. Later changes only affect bilingual screenshots and Continue hover
styling; final-candidate desktop Continue was rerun in the native suite.

Verified pre-output Completions/Responses transport recovery, bounded exhaustion
at ten retries, partial-stream interruption with one request followed by explicit
Continue, and eleven successful tool rounds without incorrectly exhausting the
next request budget. Completed tools are not rerun by stream recovery.

## Automated and build results

| Check | Actual result |
| --- | --- |
| Five targeted runtime suites: native/one-shot response recovery, provider retry/flow, subagent | 107 passed |
| MC catalog, native relay route, image relay and binding key suites | 14 passed |
| Recovery locale strings and catalog parity | 18 passed |
| Rust partial-response meta roundtrip | 1 passed; no new schema/table |
| `cargo +1.90.0 fmt --check` | Passed |
| `pnpm build:js` and runtime bundle | Passed; final desktop rebuilt after the one-line Button adjustment |
| Runtime, desktop and mobile typechecks | Passed; final desktop typecheck rerun |
| `pnpm lint:biome` | Passed, 94 included files; not a claim about files excluded by repository configuration |
| Repository whitespace check | Passed |

Native adapter tests additionally exercise delegates and one-shot completions
with max effort, signed/unsigned thinking, completed tool history across restart,
unfinished tools, safe diagnostic fields and infinite-retry boundaries. Those
delegate/auxiliary tests replace fetch at the external boundary; they are not
separate Electron UI flows for every auxiliary entry point.

## Existing baseline failures

The broader checks are not all green, and these failures were not hidden:

1. `runtime.test.ts`: 263 passed, 1 failed. The private definition pin test
   (#286) expects `provider.resolveSubagentModel` arguments to include
   `sessionId`; the implementation sends only `key`. The same assertion and
   call exist in baseline `3d96703fc`; this task does not change either.
2. Full i18n testing found `chat.reasoningSupportedBy` referenced by
   `ComposerModelPicker.tsx` but absent in all nine catalogs. The renderer
   reference and absence were confirmed in the same baseline. New recovery
   keys and catalog parity pass their targeted suites.

A separate baseline executable was not rebuilt for these source-confirmed
inconsistencies. They are follow-up maintenance, not silently fixed here.

## Verification boundaries

- No production MC/Kiro call was made. Controlled passing results do not prove
  that a production upstream conversion or max-effort incident is resolved.
- Mobile verification used the real mobile web application in phone-sized
  Chromium, not a native Android device/APK, secure storage or OS keyboard test.
- No full Rust suite, release package, push, merge or release was performed.
- Existing user histories were untouched. Partial replay metadata uses the
  existing Rust message meta field and preserves available native signatures;
  unsigned thinking remains display-only, not a claim of internal-state recovery.
