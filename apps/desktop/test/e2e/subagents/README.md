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
5. A renderer reload keeps settled state and binding details in Chinese/light;
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
