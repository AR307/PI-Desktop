# Image generation

PI-Desktop provides a fourth Composer task, Image generation. The mode button
cycles Agent, Plan, Goal, Image; its chevron opens the same four choices with
keyboard navigation and Escape dismissal. Entering Image exits planning through
the existing session configuration. Chat model and thinking level remain stored
on the session. Image model/group, declared options and active task are stored
per session in `AppSettings.imageSessions` through Rust settings persistence.

Image selection uses the existing model-then-group menu. Only authorized
MirrorCoding capabilities appear in Image mode; chat routes remain in chat
mode. Pure video models have neither route and are not offered. A model with
both declared routes appears in both menus. Groups show account-specific ratios;
dynamic groups show Dynamic billing. Unsupported options are cleared on model
change; reference attachments remain visible and block submission when unsupported.

Direct generation sends the current prompt and explicit image references only.
Count defaults to one. Unselected optional size, aspect ratio and quality are
omitted. No chat reasoning parameter is sent to image endpoints. The shared
capability contract and server handoff are in
[`mirrorcoding-image-generation-requirements.md`](../../mirrorcoding-image-generation-requirements.md).

Node sidecar uses pi's `createImagesProvider` and `generateImages`, independently
of `agent.prompt`. Main issues temporary loopback bindings, injects MirrorCoding
Bearer credentials and the encoded group, persists attachments, and coordinates
the durable turn. JSON edits use the server's JSON-to-multipart bridge. There is
no automatic endpoint, model or group substitution. Image generation is not
replayed automatically after network/rate-limit/service errors; 401 retains the
existing one-refresh authentication behavior before output.

The UI shows running state and Stop. Global session Stop and account switching
also cancel image work. Results use durable attachment cards with preview, Save,
and Use as reference. Failed or stopped anonymous URL downloads retain a retry
action that does not invoke generation again. Stopping a download records
cancellation and preserves the prompt. History records text metadata and
attachment references, not base64. Generated pixels enter a later request only
when explicitly attached. Failed/cancelled direct tasks retain draft input and
an assistant error card. Restart restores persisted cards and explicit selections.

The agent has `ListImageModels` in all execution modes and `GenerateImage` only
in Agent/execution mode. It chooses an explicit model and provider from the live
directory without changing the manual image selection. References must identify
attachments in the session; tool instructions limit historical use to images
the user explicitly requests. Text-only models receive metadata and render the
same image cards through tool results. Stop aborts the host-local image tool.

Validation enters through the actual isolated Electron Composer and real IPC,
Rust, sidecar, loopback relay, HTTP responses and filesystem attachments. The
controlled protocol fixture does not replace final deployed-MirrorCoding testing.
