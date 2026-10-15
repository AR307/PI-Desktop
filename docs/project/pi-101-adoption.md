# Pi 1.0.1 adoption

Status: task candidate commit `2c90e2ebb0598fb2e3d4b31c78265eec8a2e6d71`
on `fix/pi-1.0.1-adaptation`, based on `origin/main` at
`3b036cc7810e18b3ef7689a2b93385125a8d0a3f`.

## Scope

All five direct Pi dependencies used by Agent Runtime and Electron Main are
pinned exactly to `1.0.1`. The three existing Desktop patches were rebased on
the published 1.0.1 package contents; the pnpm lockfile records the resulting
patch hashes and upstream package versions.

| Workspace entry | Direct dependencies |
| --- | --- |
| `packages/agent-runtime` | `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` |
| `apps/desktop` | `@earendil-works/pi-ai`, `@earendil-works/pi-mcp` |

The 1.0.1 release adds retry classification for model-capacity errors in
`pi-ai`, updates Anthropic request handling and its SDK, and includes fixes for
Bedrock thinking state and OAuth callback port collisions. `pi-agent-core`'
runtime implementation is unchanged. `pi-coding-agent` and its transitive Pi
packages receive the 1.0.1 release updates. `pi-mcp` replaces the
`clientMetadataUrl` option with `clientMetadataDocument`; repository code does
not call that option directly, and the updated runtime consumes the package.

No Host RPC, Plugin SDK, provider persistence, session format, or permission
contract changes. The desktop retry classifier already retries generic
provider failures. A regression contract test now confirms both that
classification and Pi's 1.0.1 native classifier treat “Selected model is at
capacity” as retryable.

## Fresh-release policy

At adoption time, Pi 1.0.1 and seven packages in its release group are inside
the configured minimum-release-age window. `pnpm-workspace.yaml` therefore
contains exact-version exclusions for those eight packages. The dependency
check rejects missing, additional, wildcard, or non-1.0.1 exclusions. Remove
these entries once the release group clears the age window and regenerate the
lockfile; do not broaden them.

## Patch identity

| Package | Patch SHA-256 |
| --- | --- |
| `@earendil-works/pi-agent-core@1.0.1` | `02de513ae53cf7f1e92d0cfc7fce07cf880d31195f5ec621d2f2197ead92a9da` |
| `@earendil-works/pi-ai@1.0.1` | `0c7a4701594d70c49699adfef275d7c1f997d1c55d103ab09f3377523d322981` |
| `@earendil-works/pi-coding-agent@1.0.1` | `ab63d8f7817d606be15d14daedd329df64bb34e73b71c6842b02f67643ba0769` |

The `check:pi-dependencies` and `check:pi-patches` scripts verify exact direct
pins, installed package versions, patch mappings and lockfile identities, and
representative patched source and declaration contracts.

## Validation

| Candidate | `2c90e2ebb0598fb2e3d4b31c78265eec8a2e6d71` |
| --- | --- |
| Base main | `3b036cc7810e18b3ef7689a2b93385125a8d0a3f` |
| E2E suites | Pi Agent Runtime live request; protocol-level `pnpm test:e2e` |
| Result | Both passed; smoke suite 25/25 passed, 0 skipped |
| Environment | `.env`-configured model and host-core built from the candidate source; output redacted API key and endpoint. |

- `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm check:pi-dependencies`,
  `pnpm check:pi-patches`, and `pnpm audit --recursive --prod` passed; audit
  found no known vulnerabilities.
- `pnpm build:js`, agent-runtime and desktop typechecks, and `pnpm lint` passed.
- Agent Runtime: 93 files / 1,234 tests. Desktop: 3,484 tests; no failures or
  skipped tests.
- `pnpm docs:check` and `pnpm check:agent-policy` passed.
- `node scripts/e2e-agent-live.mjs` returned the expected
  `hello-from-pi-desktop` response.
- `pnpm test:e2e` passed 25/25, including live completion and streaming.
- `cargo build --locked -p host-core` passed using the shared host Cargo target.

## Rollback

Rollback the dependency manifests, lockfile, release-age entries, patch files,
and version references together. Do not roll back an individual patched Pi
package while retaining the others at 1.0.1.
