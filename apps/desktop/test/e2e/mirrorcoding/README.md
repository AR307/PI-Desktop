# MirrorCoding local acceptance

Build JS and the Rust host first. Use Node >=22.19 and the matching protocol-12
host executable. No real account or paid model is used.

```powershell
pnpm build:js
cargo +1.90.0 build -p host-core --locked
$env:PI_TEST_PLAYWRIGHT = 'path/to/playwright'
$env:PI_TEST_OUTPUT = 'absolute/path/to/new/acceptance-directory'
node apps/desktop/test/e2e/mirrorcoding/acceptance.mjs
$env:PI_TEST_OUTPUT = 'absolute/path/to/new/recovery-directory'
node apps/desktop/test/e2e/mirrorcoding/recovery.mjs
```

`acceptance.mjs` needs Docker Desktop, Edge, and a locally built MirrorCoding
image implementing the supplied Pi Desktop authorization document. The default
image is `localhost/mirrorcoding-pi-auth:20260920`; set `MIRRORCODING_TEST_IMAGE`
to the locally built image to test. Credentials are randomly generated for each
isolated service. Containers are stopped and retained with their isolated volume.
The harness captures `shell.openExternal` to open its URL in a headed Edge window;
the OS default-browser association itself is not verified.

The Electron app uses a fresh profile, actual safeStorage and Rust/sidecar wiring.
Screenshots and local request observations are written to the artifact directory,
never committed. Fixtures contain only controlled prompts; do not use an existing
personal profile for this suite. `recovery.mjs` substitutes only OS encryption and
remote HTTP boundaries and uses the real Rust provider repository.

Scenarios cover centered welcome/confirmation dialogs, skip/restart, browser
authorization, explicit model/group choices, prices, native protocols and actual
reasoning parameters, tools, inherited delegation, compaction, title/enhancement,
transient failures, interrupted output, cancellation, logout, account identity,
encrypted rotation, empty catalogs and permission changes. Reports distinguish
the real desktop UI suite from deterministic HTTP/Rust fault coverage.

Windows validation uses Rust 1.90.0, Node 24.19.0, and pnpm 11.18.0. Group-menu
screenshots also check narrow layout and keyboard focus; the welcome suite tests
both direct sign-in and skipping into Settings before sign-in.
