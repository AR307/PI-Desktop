# PI-Desktop

PI-Desktop is a local-first coding agent application. React renders the UI,
Electron coordinates host services, Rust owns persistence and native tools,
and the Node runtime executes the agent through pi libraries.

## 2026-10-07: Terminal persistence during quit

Quit stops sidecar event production and drains tracked terminal persistence
before disposing Rust host-core. Regenerated branches remain readable after
an immediate quit and restart. An unresponsive archive retains the bounded
quit behavior and logs a warning. Verification covers success, storage failure
and timeout plus an isolated Electron regenerate/quit/restart flow.
