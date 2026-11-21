# ADR 0157: Main-owned GitHub issue feedback

- Status: Accepted
- Date: 2026-09-05
- Deciders: PI-Desktop core
- Related: D120, D313, ADR 0022

## Context

Bug reports without an app version, OS, or reproduction steps cannot be triaged, and
although Settings → Info shows version and logs, users had no in-app path to GitHub
issue creation while the issue forms treated those fields as optional.

## Decision

1. GitHub issue forms are the only intake path (`blank_issues_enabled: false`).
   The bug form requires a description, reproduction steps, expected and
   actual behavior, app version, and OS. The feature form requires a problem
   and a proposed change. English is the source label language; Chinese
   remains on the same fields.
2. Settings → Info exposes one **Report a problem** row. Its action invokes
   the allowlisted `pi-desktop/app/openFeedback` channel. Electron Main builds
   a fixed GitHub bug-form URL, prefills `app-version`, `os`, and
   `environment` from Main-owned version info, and opens it with
   `shell.openExternal`. The renderer cannot supply a URL.
3. The constructed URL must stay on `https://github.com/AR307/PI-Desktop/issues/new`
   with `template=bug_report.yml`. Feature requests remain available from
   GitHub's template picker, not from a second Settings action.

## Consequences

Triage data is collected at intake, opening GitHub follows the same Main-owned URL
rule as the releases page, and no host, storage, or feed contract changes.

## Alternatives

- Renderer `window.open`: the sandbox would choose the destination.
