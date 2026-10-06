# Pi 1.0.0 adoption

Status: implemented on the `upgrade/pi-1.0.0` task candidate based on
`afe0fe4b0b52e21df1506f7ab46271a1754c643e`. The candidate is not committed,
published, or release-qualified. See the [qualification report](pi-1000-qualification.md)
for executed checks and remaining release gates.

## Scope and ownership

The migration pins all direct Pi dependencies used by Agent Runtime and
Electron Main to `1.0.0`, ports the required Desktop patches, and updates the
removed public type import. It does not adopt `pi-durable`, Codemode, a new
session owner, or a new MCP implementation. Host-core remains the only SQLite
owner; Desktop continues to own credentials, provider rows, permissions, the
Plugin SDK contract, and MCP lifecycle. The trusted-extension shim remains a
documented compatibility subset.

| Workspace entry | Direct dependencies |
| --- | --- |
| `packages/agent-runtime` | `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` |
| `apps/desktop` | `@earendil-works/pi-ai`, `@earendil-works/pi-mcp` |

All five direct pins are exact `1.0.0` versions. The pnpm lockfile records the
published package integrity values and the three patch hashes. Pi's obsolete
release-age exceptions were removed. `check:pi-dependencies` verifies the
manifest pins and installed patched instances; `check:pi-patches` verifies the
workspace mappings, lockfile patch IDs, and representative JavaScript and
declaration contracts.

The remaining type import in `agent-messages.ts` now sources `JsonValue` from
`pi-ai`, where it is exported in 1.0.0. Readonly top-level arrays are rejected
at the existing JSON-object boundary instead of being cast through the type
system. No removed Harness or session API was reintroduced.

## Compatibility behavior retained

- Pi Models remains the provider transport/auth boundary, while models.dev
  remains the source for published chat-model metadata and Host remains the
  source for account entitlement and explicit binding overrides.
- Hosted-search request, event, replay, estimation, error, persistence, and
  compaction behavior remains covered by the rebased patches and tests.
- Anthropic token requests retain bounded explicit-429 retry, deadline,
  cancellation, credential-lock, and response-redaction behavior. Pi 1.0.0's
  browser/copy-code login is connected to the existing Desktop UI bridge.
- Image generations and edits keep the existing account-scoped Pi operation,
  cancellation, ordering, artifact, and physical-usage behavior. No automatic
  retry was added for billable image requests.
- Native Pi JSONL continuation and its file lease remain on the existing
  `pi-coding-agent` path. The extension shim's legacy `VERSION` marker remains
  `0.87.1` by design; it describes the modeled extension kernel surface, not
  the installed Pi package version. Unsupported static named exports now stay
  unavailable and produce an `unsupported_api` diagnostic through the Jiti
  loader, rather than appearing silently absent.
- The packaged app now includes the models.dev snapshot at `models.dev`, which
  the app's startup catalog loader requires. A packaged-app boot probe exposed
  the missing resource; the packaging map and footprint assertion now cover it.

No database schema, Host RPC, Plugin SDK, or persisted session format changed.
The normal rollback unit is the complete dependency/patch/adapter/build set,
not an individual Pi package. The required baseline → 1.0.0 → previous-app
round trip over copied user data was not executed; see `ROLLBACK-01` below.

## Published package and patch identity

The lockfile SRI values identify the upstream npm archives; SHA-256 values
identify the exact repository patches. A frozen install and installed-instance
checks passed in the task worktree.

| Package | Version | Lockfile integrity | Patch SHA-256 |
| --- | --- | --- | --- |
| `@earendil-works/pi-agent-core` | `1.0.0` | `sha512-bHFONjtEBDqiV+g1DmmtkSlfAaqHELr+XO+6I5Nah4gswwZrLJO4yZB/JjsnlI4AKWTayBLfgS6DCbeBBz9e2Q==` | `02de513ae53cf7f1e92d0cfc7fce07cf880d31195f5ec621d2f2197ead92a9da` |
| `@earendil-works/pi-ai` | `1.0.0` | `sha512-3/W1vdDaVtpeMd23ElvJC12HLA5yS/BGqqcXF+0SK082dN7cbgNcCwguTBRBC258Ke8SzSvUW1B75iAf8w8IxA==` | `7b666ab69d8e8a12a7d02550e98a3a0020f38d7046da6dc82b237adf176475e3` |
| `@earendil-works/pi-coding-agent` | `1.0.0` | `sha512-/FtbxoSQU/mEv1QnichJjRjqteqaIaMWxmhB4G367+MwZfX7/DI5B9YAg5lqbN7nztFskBEtUSZ+FlmMBECtMw==` | `2d46470684b572b37bba57cf3cec31d81cf7747be163812b74563c8be8a95da3` |
| `@earendil-works/pi-mcp` | `1.0.0` | `sha512-rYra0aF5iPmJd+fsB+VBuqxWNABGJ3Iiyhg0CqIc/91ta2n7IvQmCp0Cac/YkUTNnvRsVZnjgAiBkRi6+ouWuw==` | — |

Patch behavior and upstream equivalence decisions are recorded in the
[patch audit](pi-1000-patch-audit.md). The active dependency boundary and
runtime specifications now describe the 1.0.0 pin; historical 0.99.1 ADRs and
validation records remain historical.
