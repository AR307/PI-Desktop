# Pi 1.0.0 patch audit

The three patches were rebuilt against the `1.0.0` npm package contents
resolved by the frozen lockfile. `pnpm install --frozen-lockfile`,
`check:pi-dependencies`, and `check:pi-patches` passed. The checks verify the
installed patched package identities and reviewed API/declaration markers;
the migration qualification tests exercise the behavior at runtime. No
upstream `package-lock.json` is modified by the patches.

## `pi-agent-core`

Patch: `patches/@earendil-works__pi-agent-core@1.0.0.patch`<br>
SHA-256: `02de513ae53cf7f1e92d0cfc7fce07cf880d31195f5ec621d2f2197ead92a9da`

- Forwards Pi AI's `hosted_search_update` progress event through the agent loop
  so Desktop can render provider-side search rounds before the final response.
- Preserves the typed local-request failure details from `pi-ai` in the agent's
  final error message, without marking aborted turns as local-request failures.
- Regression coverage: Hosted Search E2E, the runtime hosted-search tests, and
  the agent-core local error projection tests in the workspace suite.

## `pi-ai`

Patch: `patches/@earendil-works__pi-ai@1.0.0.patch`<br>
SHA-256: `7b666ab69d8e8a12a7d02550e98a3a0020f38d7046da6dc82b237adf176475e3`

- Restores Desktop's hosted-search message block, provider request opt-in,
  streamed progress events, target-API replay projection, validation, and
  model-aware estimates. Malformed replay data remains a local validation
  failure and is not sent to a provider.
- Adds local request preparation/stream error details so validation,
  serialization, and estimation failures remain distinguishable from HTTP
  errors and do not trigger provider retry or model fallback. Messages remain
  bounded and do not expose raw response bodies or credentials.
- Retains the Desktop Anthropic token-request policy: only explicit HTTP 429 is
  retried, with a bounded attempt count, caller cancellation, a shared deadline,
  preserved refresh locking, and safe recovery text.
- Reapplies required declarations for public hosted-search frames, estimators,
  and local-request errors alongside their runtime exports.
- Does not reapply the older terminal-event patch hunk. Pi 1.0.0 already owns
  the relevant `response.completed` terminal handling; the current patch keeps
  the separate Desktop-specific search and error contracts.
- Upstream 1.0.0 fixes are checked rather than duplicated: Anthropic
  `strict: "prefer"` fallback, malformed `Retry-After` fallback, Z.AI overflow
  classification, OpenAI Responses grammar tool-call replay, and the
  Anthropic copy-code login path. Runtime-contract tests and the mocked local
  OAuth bridge test cover these behaviors.

## `pi-coding-agent`

Patch: `patches/@earendil-works__pi-coding-agent@1.0.0.patch`<br>
SHA-256: `2d46470684b572b37bba57cf3cec31d81cf7747be163812b74563c8be8a95da3`

- Threads the actual model through session compaction thresholds, before/after
  estimates, branch preparation, cut-point selection, usage bookkeeping, and
  bug-report context selection. The matching `.d.ts` overloads expose the model
  parameter.
- Keeps context projection, usage anchors, compaction entries, and native JSONL
  ownership unchanged; it changes the estimate inputs so the Pi model's
  tokenizer and hosted-search replay projection are used consistently.
- `prepareBranchEntries` already existed before Pi 1.0.0. The patch makes that
  existing function model-aware; it does not claim the migration added the
  function itself.
- Regression coverage: `pi-coding-agent-compaction.test.ts`, native-session
  tests, and the full agent-runtime package suite.

No patch removes a product path or changes the Desktop persistence contract.
Any remaining test gap is recorded by acceptance ID in the
[qualification report](pi-1000-qualification.md).
