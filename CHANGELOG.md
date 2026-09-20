# Unreleased local changes

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
