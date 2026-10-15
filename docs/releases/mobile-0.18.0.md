# PI Mobile 0.18.0

- Preserve loaded history, successful delta pages and live updates when a later
  history sync page fails. Conversation controls remain available.
- Provide a localized history-sync notice with technical details and a read-only
  retry action; retrying does not resend messages or restart model work.
- Retain account pairing, multi-computer discovery, offline history and in-app
  Android updates from the previous release.

Update the paired Windows desktop to 0.18.0 as well: the old desktop can use
stale transcript offsets after a rewrite and send the JSON parse error to the
phone. The APK cannot repair desktop-owned history indexes on its own.

Android versionCode 7 retains the existing package and signing identity for
covering upgrades. The APK and mobile-update.json belong together in the
AR307/Mirrorcoding-APP release. No MC server deployment is required by this fix.
