# Session error review and validation — 2026-10-06

## Scope and evidence

The review read the reported local conversation, its tool results and the
associated application logs without changing the user's database or history.
The running installed application identifies itself as 0.15.11 in both its
package metadata and lifecycle log. Fixes use the latest committed local
0.16.1 feature baseline, including the completed mobile synchronization work.

The candidate starts from feature commit `3ad8df483`. The last origin/main
refresh resolved to `920b12b8e053165d343a421b3cb8ee93c50a436a`, already included
in that baseline. No production provider requests, pushes or releases were
performed for this review.

## Findings

The transcript contains 273 failed tool records, including delegated work.
A failed tool record is not necessarily an application defect.

| Recorded failures | Assessment and action |
| --- | --- |
| Edit 100; Write 4 | Most received payloads are incomplete edit syntax, missing paths or outdated/unseen line anchors. Of these 104 records, 59 are parse failures (55 contain a PUT header without replacement rows), 18 tag mismatches, 12 unseen lines, 3 unknown tags, 1 no-change operation and 11 missing paths. Those rejections remain. Confirmed runtime defect: delegates shared mutation failure budgets with the parent and other delegates, so failures could accumulate across agents and incorrectly end the parent turn. Budgets and pending parent termination are now isolated by executing agent. |
| Read 34 | Eleven binary-content errors were BOM-marked UTF-16LE logs. Read now decodes UTF-16LE/BE and Edit preserves byte order, BOM and line endings. The other 23 records are 16 missing files and 7 directory arguments; the supplied paths were invalid. |
| Bash 124 | Nonzero commands, six timeouts, quoting mistakes, unavailable tools/services and project build/test failures. No common PI execution defect was demonstrated. Exit codes remain visible. |
| Glob 4; Grep 3 | Requested directories did not exist. No change to path validation. |
| BrowserPreview 1 | The requested scratch file was outside this tool's documented workspace-relative scope. Transcript HTML links use the broader session-owned preview path; this is a different entry point. |
| Browser plugin 3 | Two CDP methods were outside the plugin allowlist. One guest-unavailable result lacks enough evidence to prove a lifecycle defect. No permission broadening or speculative fix. |

Seven terminal error log entries fall into three categories:

- Three `MUTATION_RETRY_BUDGET_EXHAUSTED` entries. Invalid edits are real, but
  shared parent/delegate recovery accounting was a client defect fixed here.
- Three `STREAM_FAILED` entries after 180 seconds without provider events.
  Each stream had already delivered content. Existing preservation and
  no-replay behavior is intentional; the evidence cannot locate the stalled
  hop within the provider, gateway or network.
- One provider stream error reporting an operation-equivalence failure while
  correcting tool transport. HTTP 200 preceded that error; it was not evidence
  that PI executed the corrected tool. The upstream payload reports that no
  tool was executed. PI retains the partial response and error.

An additional persistence warning occurred 17 ms after application shutdown:
`save active regenerate branch failed: host-core disposed`. The race reproduced
in the quit-handler regression. Terminal writes are now tracked separately from
active turns, and quit stops sidecar events and drains those writes before
disposing host-core. The drain is bounded; an unavailable host still permits
exit with an explicit warning.

## Executed validation

| Check | Result |
| --- | --- |
| Read-only incident audit | Full persisted error inventory and corresponding terminal logs reviewed; user history unchanged. |
| Runtime suite on the delegate-isolation module | 98 files, 1,357 tests passed. |
| Integrated runtime, provider retry and native response recovery | 378 tests passed. |
| Host-core suite | 782 tests passed with one test thread. A process-abort race in the first parallel run passed independently and in the subsequent serial suite. |
| Desktop persistence/quit/turn/checkpoint tests | 39 tests passed, including successful, failed and unresponsive branch writes. The new race test failed against the original shutdown order. |
| TypeScript | Desktop and agent-runtime checks passed; all nine shared package builds passed. |
| Desktop build | Electron Main, Preload and Renderer production build passed. Agent sidecar was rebuilt. |
| Source checks | Rust formatting, diff whitespace and desktop style-token checks passed. |
| Real delegate execution | `scripts/e2e-subagent-edit-isolation.mjs` ran the real runtime, pi Agent and SubagentRun against a local HTTP/SSE provider. A failed three times, B continued after A stopped, and the parent had no mutation-budget error. |
| Real Electron user path | `apps/desktop/test/e2e/session-error-review.mjs` used a new profile, controlled MC authorization and a real Rust host. It read a Chinese UTF-16 log, regenerated via the transcript menu, quit at completion, reopened and read both original and regenerated branches. Six assertions passed; no disposed-host archive error. The UTF-16 assertion failed with the old host binary. |

The Electron run retained screenshots and its isolated profile under
`.artifacts/session-errors-1791299536962/`. Screenshots were inspected, including
the completed reply before quit and the regenerated reply after restart. The
Rust executable used there was built from `4e4a6af7a`; its entire host-core source
tree matches the integrated candidate.

One separate session-collaboration cancellation warning appeared during the
deliberately immediate quit. It is a canceled follow-up operation, not the
disposed-host archive failure; no missing transcript or branch was observed.

## Verification boundaries

These results establish the client defects and controlled fixes. They do not
establish why a production stream stopped emitting events, why the upstream
tool-transport correction failed, or whether that provider has recovered.
No timeout increase, protocol substitution, automatic whole-turn replay or
permission expansion was introduced. Existing installed applications are not
replaced by these local commits.
