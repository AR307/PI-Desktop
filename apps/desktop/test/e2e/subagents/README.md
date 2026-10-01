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
