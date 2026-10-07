# PI-Desktop

PI-Desktop is a local-first coding agent application. React renders the UI,
Electron coordinates host services, Rust owns persistence and native tools,
and the Node runtime executes the agent through pi libraries.

## 2026-10-07: BOM-marked UTF-16 tool support

Read accepts UTF-16LE/BE logs and text files. Edit restores the original byte
order, BOM and line endings. Host tool regressions cover LE PowerShell logs
and BE Chinese text. The controlled Electron flow also reads a Chinese log
through the real sidecar and host.
