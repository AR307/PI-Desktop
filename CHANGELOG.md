# Unreleased local changes

## Image generation

- Add an Agent/Plan/Goal/Image split mode button and separate per-session image selection.
- Filter model menus by chat/image capability and keep model/group billing visible.
- Generate from explicit prompts and references through pi's image provider,
  using main-owned MirrorCoding authentication and the selected group.
- Persist image cards with preview, save, reference reuse and download-only retry.
- Let chat agents query image models and generate images with their own selection.
- Cancel image work through Stop and account sign-out. Preserve chat reasoning
  and report uncertain generation failures without automatically replaying them.
- Define the server team's image catalog and endpoint requirements separately.

## Work-panel window behavior

- Allow native window dragging from empty space beside work-panel tabs.
- Keep browser pages responsive when screenshot capture overlaps panel or
  window resizing, including concurrent and failed captures.

## MirrorCoding account integration

- Added optional first-launch authorization and Settings → Account.
- Automatically synchronize account models and groups; select model then group
  with account-specific multipliers and dynamic billing labels.
- Keep tokens encrypted in main and relay all model calls with the selected
  group, native protocol and reasoning parameters.
- Retain partial output on interruption, refresh expiring grants concurrently,
  and support offline sign-out with deferred server revocation.
- Center welcome and running-task confirmation dialogs at normal/narrow widths.
- Existing manual providers and vendor-account connections remain available.

This is a local development change, not a published release or server deployment.
