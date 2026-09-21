# Image generation outside the conversational agent loop

Status: Accepted for local implementation, 2026-09-21.

## Context

Image endpoints accept prompts and explicit references and return final images.
They cannot be treated as a chat adapter without accidentally sending history,
reasoning fields, tool schemas or auxiliary title/compaction requests. At the
same time, chat agents need image tools, and MirrorCoding credentials already
belong exclusively to main.

## Decision

Use pi's installed ImagesProvider extension in the Node sidecar. A focused main
ImageService owns task orchestration and durable attachment coordination, while
Rust remains the owner of settings and transcript persistence. Both direct
Composer image tasks and host-local agent tools call this service. The existing
MirrorCoding loopback relay adds image bindings and otherwise preserves credential
ownership. JSON references are normalized at the client contract and converted
by MirrorCoding's actual vendor adapter.

Use existing provider IDs as account/group identity. Store image selection in
the settings document by session, separately from session chat configuration.
Extend transcript content blocks with image results, requiring no new SQL table.
URL outputs remain pending downloadable records when transfer fails; generation
is never invoked as a download recovery mechanism.

## Alternatives and consequences

Running image serialization in main would bypass the installed pi image API
and duplicate the runtime boundary. Routing image generation through chat would
confuse prompt history, reasoning and tool execution. A second database table
or a second group identity would duplicate existing persistence concepts.

The selected design adds only an image task RPC and host-local tool bridge.
It also requires a synchronized Rust transcript field and explicit cancellation
across the local-tool bridge. Desktop capability menus depend on the server
declaring accurate model/group capabilities. Protocol fixtures prove PI wiring;
MirrorCoding deployment and real upstream billing/adapter behavior require
separate server-team acceptance.
