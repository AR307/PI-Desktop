# Consolidated local preview

Date: 2026-10-01. Application version: 0.15.10.

## Included changes

The dedicated codex/pi-integrated-test worktree includes current fork main
920b12b8e053165d343a421b3cb8ee93c50a436a and the entire completed chain through
c41acccc4002ead0ed1050591db851e8e4faf8a6. MC client-catalog routing, session and
child Fast, response recovery, image generation, Android synchronization and
controls, upstream 0.15.10 fixes, and Ultra collaboration are included.

The MC/Fast, upstream integration and Ultra branch heads are ancestors of this
candidate. Historical pre-rewrite branches are not blindly reintroduced. The
latest completed task is already cumulative, so Git integration is a fast
forward rather than a duplicate cherry-pick or conflicting historical merge.

## Local delivery

Rebuild the compiled runtime and bundled sidecar before launching. Reuse the
installed toolchain and dependencies; keep mutable profiles and outputs local
to this worktree. The visible preview uses the normal MC origin, not a stopped
fixture. No production or paid model requests are part of automated validation.

No push, release, server deployment, permanent file deletion or change to the
primary checkout is included. Final acceptance results follow after the build.
