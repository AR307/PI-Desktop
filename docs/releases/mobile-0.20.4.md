# PI Mobile 0.20.4

- Fix in-app updates offering an APK downloaded for an earlier release. A newer
  release could not be downloaded, and "Install update" reopened the old
  package. Each download now belongs to its release, and leftovers are
  cleared.
- Check for, download and install updates from the login screen again before
  signing in.

If your phone already used an in-app update on 0.20.3 or earlier, install this
release once from the release page. Later updates then work inside the app.

Compatible with PI Desktop 0.20.2; no desktop update or MC deployment is
required. Android versionCode 10 keeps the existing package and signing
identity, so it installs over earlier versions.
