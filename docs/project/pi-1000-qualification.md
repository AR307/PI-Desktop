# Pi 1.0.0 migration qualification

Status is for the task candidate based on
commit `d636e8a88`, based on `afe0fe4b0b52e21df1506f7ab46271a1754c643e`, on
branch `upgrade/pi-1.0.0` in the dedicated worktree. `PASS` means the stated
local evidence ran; it does not extend to a live provider, real user data, or
another platform. See the release limitations at the end.

## Task candidate E2E

- Task candidate commit: `d636e8a88`
- Base main: `afe0fe4b0b52e21df1506f7ab46271a1754c643e`
- E2E suites: Hosted Search, images, trusted extensions, provider order,
  provider API style, subagents, subagent models, remote host, Live Voice, and
  Live Voice interaction.
- Result: **PASS** on every listed suite.
- Environment: macOS arm64 with local fixtures and isolated temporary profiles.
  The compatible Host Core binary was rebuilt with `cargo build --locked
  -p host-core` using the host's shared Cargo target. The older prebuilt binary
  lacked the current `session.recordUsage` RPC and was not used for the passing
  candidate run.

## Environment and artifact identity

- Host: macOS arm64, Node `v26.0.0`, pnpm `12.8.1`.
- Frozen install: `pnpm install --frozen-lockfile` — **PASS**.
- Pi dependency graph: `pnpm check:pi-dependencies` — **PASS**.
- Patch map, installed patch hashes, and declaration contracts:
  `pnpm check:pi-patches` — **PASS**.
- Final standalone Agent Runtime bundle SHA-256:
  `592808ec5b46ba7c36c74a1174176abc29c79d25534d9c04e0e2531b21e29191`
  (`packages/agent-runtime/dist-bundle/sidecar.js` entry file).
- Hosted Search's final 7-scenario E2E snapshot digest (entry + ESM marker +
  relative chunks): `f985081cb1f3fd1220dbb5d15bde98e1f976cee8f9f103dd3bdefdcc4067f6db`.
- `pnpm test:e2e:hosted-search` wrote fixture evidence to
  `/var/folders/pw/qtkwc6cx67d28cj0znhrklg00000gn/T/hosted-search-e2e-fp602Z/result.json`.
- The packaged artifact checked was an unsigned macOS arm64 `.app` directory
  build. Electron Builder reported no Developer ID signing identity; no
  installer was signed, uploaded, or released.

## Acceptance matrix

| ID | Status | Evidence / limitation |
| --- | --- | --- |
| DEP-01 | PASS | Frozen install; lockfile SRI and all three patch hashes are recorded in `pi-1000-adoption.md`. |
| DEP-02 | PASS | Direct Main/Sidecar pins and installed patch identities checked; JS build, sidecar bundle, E2Es, and packaged macOS app boot exercised. Other OS launchers not run. |
| TYPE-01 | PASS | Workspace builds and package typechecks passed; `agent-messages.ts` regression covers the 1.0 `JsonValue` boundary. |
| LOOP-01 | PASS | Agent Runtime package suite and trusted-extension E2E cover message/tool/error ordering, abort, and blocked tools. |
| SEARCH-01 | PASS | Production sidecar Hosted Search E2E includes provider request, progress, result, and citation scenarios. |
| SEARCH-02 | PASS | E2E covers next prompt, Read, changed instructions, and delegated Task replay. |
| SEARCH-03 | PASS | E2E covers persisted restore; focused tests cover usage anchors and compaction projection. |
| SEARCH-04 | PASS | E2E covers invalid container/phase; focused tests cover error results and old/missing fields. |
| SEARCH-05 | PASS | Focused Hosted Search projection tests and E2E cover compatible provider/API projections and disabled/invalid search states. |
| ERROR-01 | PASS | Runtime suite covers local validation/estimation failures; no request is issued for rejected local input. |
| ERROR-02 | PASS | Runtime request/retry tests and Anthropic retry suite distinguish HTTP outcomes, cancellation, and ambiguous network failures. |
| UPSTREAM-01 | PASS | Pi 1.0 contract test exercises Anthropic strict-schema fallback behavior. |
| UPSTREAM-02 | PASS | Pi 1.0 contract test covers malformed Retry-After, Z.AI overflow, and grammar tool-call replay. |
| AUTH-01 | PASS | Offline Desktop OAuth tests exercise browser and copy-code paths, cancellation, state, and the Pi 1.0 Anthropic select/manual-code bridge. Real account login not run. |
| AUTH-02 | PASS | OAuth retry suite: explicit 429 bounds, deadlines, invalid_grant, 5xx, network failure, cancellation, safe text, and credential retention. |
| AUTH-03 | PASS | OAuth suite covers concurrent writes and separate same-vendor accounts with mocked external I/O; no real credential store was used. |
| MODEL-01 | PASS | OAuth/catalog and runtime tests cover account entitlement, explicit overrides, unknown/ambiguous models, and sibling metadata isolation. |
| IMAGE-01 | PASS | All three image E2E scripts passed with local HTTP fixtures; no real provider request. |
| IMAGE-02 | PASS | Image E2E covered batch, edit, download, unconfigured state, ordering, and no duplicate operation. Focused tests cover cancellation, limits, and failures. |
| USAGE-01 | PASS | Workspace tests and subagent/image E2Es cover physical request usage, replay, delegation, and image attribution. |
| NATIVE-01 | PASS | Native-session and compaction regression suites passed; packaged boot probe read 800 temporary session records. No user profile was opened. |
| NATIVE-02 | PASS | Native-session/lease tests passed for conflict and file ownership guards; no external native-session files were modified. |
| NATIVE-03 | PASS | Runtime lifecycle tests and trusted-extension E2E passed for startup failure, cancellation, settlement, and tool restrictions. |
| EXT-01 | PASS | Trusted-extension E2E: 40/40 scenarios passed for aliases, TS loading, cache reuse, types, diagnostics, extension tool results, and blocked Bash. |
| EXT-02 | PASS | Runner tests use the real Jiti loader with an unsupported static named import; it stays undefined and emits an `unsupported_api` diagnostic. Direct missing-export access and legacy aliases are covered too. |
| BUNDLE-01 | PASS | Standalone OAuth bundle test passed outside the repository with empty `NODE_PATH`; sidecar E2E ran the generated bundle. |
| RELEASE-01 | BLOCKED_ENVIRONMENT | macOS arm64 `.app` directory packaging and isolated boot passed, including Host protocol 11 and 800 temporary session reads. Windows/Linux and signed installers were not available. |
| ROLLBACK-01 | NOT_RUN | No baseline → candidate → prior-app round trip was run against copied application data. It remains a release gate. |

## Executed checks

| Command / run | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm check:pi-dependencies && pnpm check:pi-patches` | PASS |
| `pnpm typecheck` | PASS; workspace builds (including docs and Desktop) and typechecks completed |
| `pnpm lint` | PASS; Biome and style-token checks |
| `pnpm docs:check && pnpm check:release-docs` | PASS; 84 locale pairs, 553 documentation pages, release docs aligned |
| `pnpm check:agent-policy && pnpm check:pr-base` | PASS; policy synchronized and `origin/main` is the task base |
| `git diff --check` | PASS |
| Pi focused Runtime tests from the migration plan | PASS, 123 tests / 8 files |
| OAuth tests (`vendor-oauth-login`, `anthropic-oauth-retry`, `oauth-standalone-bundle`) | PASS, 57 tests |
| `pnpm test:e2e:hosted-search` | PASS, 7 scenarios; snapshot digest above |
| `pnpm test:e2e:images` | PASS, 25 scenarios over generation, UI, and full desktop chat with local fixtures |
| Trusted extensions E2E | PASS, 39 scenarios |
| Provider order, provider API style, subagents, subagent models, remote host | PASS, results recorded from local fixture runs |
| Live Voice E2E and interaction E2E | PASS, local TLS/realtime fixtures and 51 UI journeys; no real account/device call |
| Packaged boot probe | PASS, isolated temporary data directory; 800 session reads, protocol 11 |
| `pnpm run pack` | PASS, macOS arm64 unsigned `.app` directory build; Builder warned that no signing identity was present |
| `test/packaging-footprint.test.mjs` | PASS, 9 tests; models.dev resource is present in package mapping |
| `pnpm -r --if-present test` | PASS, all workspace package suites completed with exit code 0 |
| `cargo build --locked -p host-core` | PASS, rebuilt the stale shared Host Core artifact to provide the current `session.recordUsage` RPC for isolated E2E runs |
| Task-candidate E2E suites listed above | PASS; all ran against commit `d636e8a88` with local fixtures |

E2E fixtures used local providers and temporary data directories. No paid API,
real provider, real user profile, live OAuth account, or real Desktop window was
used. Temporary artifacts from the harness are under the OS temp directory.

## Release limitations

- `RELEASE-01` is only qualified for the macOS arm64 directory build and boot
  probe; Windows/Linux installers and signing are not covered.
- `ROLLBACK-01` remains untested. Validate a copied user-data set with the
  previous app after candidate use before calling the migration publish-ready.
- Live Anthropic account/browser authentication and real provider usage were
  intentionally not exercised. They require a separate explicit release
  qualification run; all local OAuth flows in this report used fixtures.
