# PI-Desktop

PI-Desktop is a local-first coding agent application. React renders the UI,
Electron coordinates host services, Rust owns persistence and native tools,
and the Node runtime executes the agent through pi libraries.

## 2026-10-07: Delegate mutation recovery

Mutation counts and recovery graces are isolated by the executing agent.
Exhaustion returns a failed, resumable Task result instead of completing the
delegate and failing the parent. Shared recovery descriptions now live in a
small module rather than growing the runtime entry point. Controlled HTTP
flows cover concurrent Edit and shell patch failures plus Task resume.
