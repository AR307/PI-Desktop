# PI Mobile 0.16.2

- Check for updates from Account, download the Android APK, and open the system
  installer. Downloads support cancellation, retry and app-restart recovery.
- Pair an account once to discover computers which enable account sharing,
  including their projects, ungrouped conversations and later additions.
- Read loaded history and downloaded attachments offline. Previously loaded
  messages are no longer limited to the latest 500 rows.
- Resume with durable message changes after a desktop restart. Preserve expanded
  long content and reading pages while incoming changes are reconciled.
- Keep cached visibility aligned with remaining project/session grants when
  account sharing is revoked.

The first APK containing the updater must be installed manually. Account-wide
discovery requires the corresponding MC service update and the new desktop
sync contract. The previous unpartitioned tail cache is refreshed once on this
upgrade; desktop conversation data is unchanged. The APK and generated
`mobile-update.json` are published together in `AR307/Mirrorcoding-APP`.
Android versionCode 6 retains the existing signing identity and application ID
for covering upgrades. Controlled acceptance is recorded separately from
production MC integration in the [combined release notes](0.16.2.md).
