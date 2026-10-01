# Subagent controls acceptance

This suite opens an isolated, real Electron window against a loopback MC auth,
catalog and streamed-model fixture. It never uses the user's profile or paid
models. Screenshots and a bounded request summary stay in the ignored artifacts
directory; no credentials or user conversation content are captured.

## Run

Build shared/runtime dependencies, bundle the agent sidecar, and build Desktop
before running:

```sh
node apps/desktop/test/e2e/subagents/acceptance.mjs
```

- Set PI_TEST_OUTPUT to a fresh evidence directory.
- Set PI_TEST_PLAYWRIGHT to the installed Playwright module if not on the package
  resolution path. Set PI_DESKTOP_HOST_BIN to a compiled host when needed.
- The suite launches and closes only its own Electron/host processes.

## User journeys

1. Astra delegates to Grok 4.7 on two exact MC channels and receives truthful
   startup bindings.
2. Parent Stop leaves both child streams and cards running. Keyboard Stop on a
   child cancels one; group Stop cancels the other.
3. A completed background worker wakes its parent without a fake user bubble.
4. A failed worker resumes on its original model/channel.
5. Ultra releases the parent after a complete parallel dispatch, without Stop or
   a second parent request. The user can type and send while workers run.
6. Staggered and rapid reports silently wake integration without duplicate
   workers, fake user bubbles, polling or lost drafts.
7. A renderer reload keeps settled state and binding details in Chinese/light;
   initial interactions use English/dark. Screenshots cover both themes.

The fixture controls model choices, so this is not proof of autonomous model
obedience, production MC access, or a live provider's reliability.

## Local validation, 2026-10-01

- Task candidate: d5cd009693bc8826e8835cbec3bbc8ed3f81a861.
- Base origin/main: 920b12b8e053165d343a421b3cb8ee93c50a436a, fetched
  successfully before candidate validation and verified as an ancestor.
- Electron acceptance: 6/6 user journeys passed, no renderer page errors.
  Evidence: .artifacts/subagent-controls-final/result.json and screenshots.
  Visually inspected running-after-parent-stop.png (English/dark) and
  persisted-light-zh.png (Chinese/light) from that candidate.
- Targeted checks: Desktop 137, runtime 346, host-runtime 22, agent-host 46,
  shared protocol 14 and i18n 37 tests passed (602 total).
- Shared, i18n, agent-host, host-runtime, agent-runtime, Desktop, pi-host and
  mobile TypeScript checks passed. Runtime JS and sidecar bundle plus Electron
  build passed. Repository-configured scoped Biome and style-token checks,
  plus git diff whitespace checks, passed. Biome currently checks only two of
  the changed files under the repository's allowlist; it is not full coverage.
- No Rust source changed, so no Rust rebuild/test was required. No full monorepo
  suite, Android device test or production/paid-model call ran in this task.
  Actual autonomous model compliance and production channel authorization remain
  outside controlled-fixture acceptance. The user's live preview was not stopped
  or restarted. No push, release or MC deployment was performed.

A following documentation-only commit records this evidence; the tested
executable source tree remains unchanged.

## Ultra handoff validation, 2026-10-01

- Task candidate: 7528d904afe02bdd3ae562d7c4be66587a242f78.
- Base origin/main: 920b12b8e053165d343a421b3cb8ee93c50a436a, freshly fetched
  and verified as an ancestor before final candidate acceptance.
- Runtime regressions: 351/351 passed across runtime.test.ts,
  ultra-policy.test.ts, delegation-chain.test.ts and delegation-history.test.ts.
  The initial repro made two parent requests for held workers and three for
  immediate workers instead of one; both now yield at the native boundary.
  A separate red/green regression preserves user input admitted at handoff.
- Actual Electron acceptance: 10/10 checks passed, no renderer page errors.
  Evidence: .artifacts/ultra-handoff-final/result.json, run.log and screenshots.
  Visually inspected the idle parent with two running workers, editable draft,
  report integration and the Chinese/light reload. No user profile was used.
- Shared and desktop dependency TypeScript builds passed, including agent-runtime
  and host-runtime; Desktop noEmit typecheck, rebuilt sidecar and electron-vite
  build passed. E2E script syntax and git diff whitespace checks passed.
- Repository Biome includes do not cover the changed runtime/E2E files; no lint
  coverage is claimed for them. No Rust source changed, so existing provisioned
  host binaries were reused. No full monorepo suite, Android-device run, paid
  model call or production MC acceptance was performed.
- No live-preview restart, push, release, or server deployment. Documentation-only
  follow-up records this result without changing the tested executable tree.

## ReturnToParent acceptance, 2026-10-01

- Task candidate: 80630e583c44c83ad036d2acbec2e397fa15ae9e.
- Base main: 920b12b8e053165d343a421b3cb8ee93c50a436a, fetched before
  candidate preparation and verified as an ancestor. The branch preserves the
  previously validated Ultra handoff implementation. A linear rebase attempt
  encountered unrelated historical merge conflicts and was aborted; no unrelated
  conflict was resolved or retained.
- Runtime tests: 374 passed (runtime, return operation, Ultra policy, delegation
  history and child runtime). Desktop projection/presentation tests: 137 passed.
  Mobile transcript tests: 15 passed. i18n tests: 37 passed.
- Shared/i18n/runtime/desktop/mobile TypeScript checks passed. Desktop, rebuilt
  sidecar and mobile web builds passed. Style-token validation passed.
  Scoped Biome lint processed no files because these paths are outside its
  configured includes; it is not reported as a successful lint run.
- Actual isolated Electron + local controlled MC/HTTP/SSE: 15 checks passed,
  no renderer errors. Covers parallel model/channel binding, parent/child Stop,
  visible successful/failed/stopped returns, keyboard expansion, failed-worker
  resume, Ultra handoff, explicit user input, rapid completion and reload.
  Dark/English and light/Chinese screenshots were visually reviewed.
- Evidence: .artifacts/return-to-parent-final/result.json, run.log and
  return-completed.png / return-reload-light-zh.png. The first candidate exposed
  an outer-process folding bug; evidence remains separately in
  .artifacts/return-to-parent-candidate and the final candidate fixes it.
- No production MC or paid model requests, Android-device installation, user
  preview restart, Git push or release. Rust was unchanged; no Cargo suite ran.
